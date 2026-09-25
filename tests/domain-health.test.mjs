import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import { period } from "../workers/period.mjs";
test("domain lifecycle counts and access snapshots survive deletion and respect dates", async () => {
  const h = await harness();
  try {
    const d = await (
      await h.call("domains", "POST", { hostname: "health.example.com" })
    ).json();
    const payload = {
      name: "Campanha",
      slug: "campanha",
      mode: "waiting",
      device: "all",
      real_urls: [],
      waiting_url: "",
      domain_id: d.id,
    };
    const res = await h.call("links", "POST", payload);
    assert.equal(res.status, 201);
    const l = await res.json();
    await h.env.DB.prepare(
      "INSERT INTO clicks(link_id,hostname,device,destination,country,created_at,link_name,slug) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        l.id,
        d.hostname,
        "mobile",
        "waiting",
        "BR",
        "2026-01-02T03:00:00.000Z",
        "Campanha",
        "campanha",
      )
      .run();
    const q = "from=2026-01-02T03:00:00.000Z&to=2026-01-03T03:00:00.000Z";
    let stats = await (await h.call("domain-health?" + q)).json();
    assert.equal(stats.items[0].accesses, 1);
    assert.equal(stats.items[0].current_links, 1);
    assert.equal((await h.call("links/" + l.id, "DELETE")).status, 200);
    stats = await (await h.call("domain-health")).json();
    assert.equal(stats.items[0].created_links, 1);
    assert.equal(stats.items[0].deleted_links, 1);
    assert.equal(stats.items[0].current_links, 0);
    assert.equal(stats.items[0].first_access, "2026-01-02T03:00:00.000Z");
    const logs = await (
      await h.call("logs?" + q + "&hostname=" + d.hostname)
    ).json();
    assert.equal(logs.items.length, 1);
    assert.equal(logs.items[0].link_name, "Campanha");
    assert.equal(
      (await (await h.call("logs?" + q + "&hostname=other.example.com")).json())
        .items.length,
      0,
    );
    assert.equal(
      (await (await h.call("analytics?" + q)).json()).summary.total,
      1,
    );
    assert.equal((await h.call("analytics?from=bad&to=bad")).status, 400);
    assert.equal(
      (await h.call("links", "POST", { ...payload, domain_id: "unknown" }))
        .status,
      400,
    );
  } finally {
    h.close();
  }
});
test("custom period boundaries reject reversed or excessive ranges", () => {
  assert.throws(() =>
    period(new URLSearchParams({ from: "2026-03-02", to: "2026-03-01" })),
  );
  assert.throws(() =>
    period(new URLSearchParams({ from: "2020-01-01", to: "2026-01-01" })),
  );
  assert.equal(
    period(
      new URLSearchParams({
        from: "2026-01-01T03:00:00Z",
        to: "2026-01-02T03:00:00Z",
      }),
    ).from,
    "2026-01-01T03:00:00.000Z",
  );
});
