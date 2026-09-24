import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import {
  renderWaitingPage,
  validateWaitingPage,
  waitingThemes,
} from "../workers/waiting-page.mjs";
import redirect from "../workers/redirect.mjs";
import api from "../workers/api.mjs";
test("institutional templates escape content, validate fields and differ by explicit theme", () => {
  for (const theme of waitingThemes) {
    const html = renderWaitingPage(
      {
        theme: theme.id,
        company: "A <script>alert(1)</script>",
        services: ["<img src=x onerror=alert(1)>"],
      },
      "Fallback",
    );
    assert.ok(html.includes(`data-theme="${theme.id}"`));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes("facebook-domain-verification"));
  }
  assert.equal(
    validateWaitingPage({ whatsapp: "+55 (11) 99999-9999" }).whatsapp,
    "5511999999999",
  );
  for (const input of [
    { theme: "bad" },
    { email: 'x" onclick="alert(1)' },
    { opening_date: "2026-02-31" },
    { services: ["a".repeat(181)] },
    { services: Array(9).fill("s") },
    { whatsapp: "javascript:1" },
  ])
    assert.throws(() => validateWaitingPage(input));
  assert.ok(!renderWaitingPage({}).includes("CNPJ:"));
});
test("waiting page CRUD, external URL priority and paginated access history", async () => {
  const h = await harness();
  const pending = [];
  try {
    assert.equal(
      (await api.fetch(new Request("https://aprovabmyksh.com/api/logs"), h.env))
        .status,
      401,
    );
    const payload = {
      name: "Teste institucional",
      slug: "institucional",
      mode: "waiting",
      device: "all",
      real_urls: [],
      waiting_url: "",
      waiting_page: {
        theme: "forest",
        company: "Empresa teste",
        headline: "Serviços locais",
        services: ["Coletas", "Entregas"],
        whatsapp: "5511999999999",
      },
    };
    let res = await h.call("links", "POST", payload);
    assert.equal(res.status, 201);
    const link = await res.json();
    const listed = await (await h.call("links")).json();
    assert.equal(listed[0].waiting_page.theme, "forest");
    const domain = await (
      await h.call("domains", "POST", { hostname: "links.example.com" })
    ).json();
    await h.env.DB.prepare("UPDATE domains SET verified=1 WHERE id=?")
      .bind(domain.id)
      .run();
    const visit = () =>
      redirect.fetch(
        new Request("https://links.example.com/institucional", {
          headers: { "user-agent": "iPhone" },
        }),
        h.env,
        { waitUntil: (p) => pending.push(p) },
      );
    res = await visit();
    assert.equal(res.status, 200);
    let html = await res.text();
    assert.ok(html.includes('data-theme="forest"'));
    assert.ok(html.includes("Empresa teste"));
    assert.ok(html.includes("https://wa.me/5511999999999"));
    await Promise.all(pending);
    let logs = await (await h.call("logs")).json();
    assert.equal(logs.items.length, 1);
    assert.equal(logs.items[0].device, "mobile");
    assert.equal(logs.items[0].destination, "waiting");
    assert.ok(Number.isFinite(Date.parse(logs.items[0].created_at)));
    res = await h.call("links/" + link.id, "PUT", {
      ...payload,
      waiting_page: { ...payload.waiting_page, theme: "midnight" },
    });
    assert.equal(res.status, 200);
    html = await (await visit()).text();
    assert.ok(html.includes('data-theme="midnight"'));
    await Promise.all(pending);
    await h.call("links/" + link.id, "PUT", {
      ...payload,
      waiting_url: "https://example.com/espera",
    });
    res = await visit();
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "https://example.com/espera");
    await Promise.all(pending);
    for (let i = 0; i < 56; i++)
      await h.env.DB.prepare(
        "INSERT INTO clicks(link_id,hostname,device,destination,country,created_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          link.id,
          "links.example.com",
          i % 2 ? "mobile" : "desktop",
          i % 2 ? "real" : "waiting",
          "BR",
          `2026-01-01T12:${String(i).padStart(2, "0")}:00.000Z`,
        )
        .run();
    logs = await (await h.call("logs")).json();
    assert.equal(logs.items.length, 50);
    assert.ok(logs.next_cursor);
    const second = await (
      await h.call("logs?cursor=" + logs.next_cursor)
    ).json();
    assert.equal(second.items.length, 9);
    assert.equal(second.next_cursor, null);
    assert.equal(
      new Set([...logs.items, ...second.items].map((x) => x.id)).size,
      59,
    );
    const filtered = await (
      await h.call(
        "logs?device=mobile&destination=real&link=" +
          link.id +
          "&from=2026-01-01T12%3A00%3A00Z&to=2026-01-01T12%3A10%3A00Z",
      )
    ).json();
    assert.equal(filtered.items.length, 5);
    assert.ok(
      filtered.items.every(
        (x) => x.device === "mobile" && x.destination === "real",
      ),
    );
    assert.equal((await h.call("logs?cursor=-1")).status, 400);
    assert.equal((await h.call("logs?device=bot")).status, 400);
    assert.equal(
      (await h.call("logs?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z"))
        .status,
      400,
    );
  } finally {
    await Promise.allSettled(pending);
    h.close();
  }
});
