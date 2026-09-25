import test from "node:test";
import assert from "node:assert/strict";
import { collectTraffic, classifyTraffic } from "../workers/traffic.mjs";
import redirect from "../workers/redirect.mjs";
import { harness } from "./harness.mjs";
const browserHeaders = {
  "user-agent": "Mozilla/5.0 Chrome/130.0 Safari/537.36",
  accept: "text/html",
  "accept-language": "pt-BR",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};
function request(headers = {}, cf, method = "GET") {
  const r = new Request("https://links.example.com/traffic", {
    headers,
    method,
  });
  if (cf) Object.defineProperty(r, "cf", { value: cf });
  return r;
}
const classify = (headers, cf, recent) =>
  classifyTraffic(collectTraffic(request(headers, cf)), recent);
test("recognized crawlers, previews and automation are probable, never confirmed by UA/ASN", () => {
  for (const [ua, provider] of [
    ["facebookexternalhit/1.1", "meta"],
    ["Facebot", "meta"],
    ["meta-externalagent/1.1", "meta"],
    ["WhatsApp/2.0", "whatsapp"],
    ["Googlebot", "google"],
    ["bingbot", "bing"],
    ["GPTBot", "other"],
    ["Slackbot", "other"],
    ["curl/8", "other"],
    ["HeadlessChrome/120", "other"],
    ["python-requests/2", "other"],
  ]) {
    const value = classify({ "user-agent": ua }, { asn: 32934 });
    assert.equal(value.classification, "probable_bot", ua);
    assert.equal(value.bot_provider, provider);
    assert.equal(value.is_bot, true);
    assert.ok(value.bot_confidence >= 60 && value.bot_confidence < 100);
    assert.ok(value.bot_reason.length);
  }
  assert.equal(
    classify(browserHeaders, { asn: 32934 }).bot_provider,
    "unknown",
  );
});
test("trusted Cloudflare signals confirm automation but never confirm WhatsApp identity", () => {
  for (const botManagement of [{ verifiedBot: true }, { signedAgent: true }]) {
    const value = classify({ "user-agent": "WhatsApp/2.0" }, { botManagement });
    assert.equal(value.classification, "confirmed_bot");
    assert.equal(value.bot_confidence, 100);
    assert.match(value.bot_reason.join(" "), /apenas provável/);
  }
  assert.equal(
    classify(browserHeaders, { botManagement: { score: 1 } }).classification,
    "probable_bot",
  );
  assert.equal(
    classify({
      ...browserHeaders,
      "cf-bot-score": "1",
      "cf-verified-bot": "true",
    }).classification,
    "human",
  );
});
test("missing features, first-visit JS failures and corporate networks do not imply automation", () => {
  const unknown = classify({});
  assert.equal(unknown.classification, "unknown");
  assert.equal(unknown.is_bot, null);
  for (const score of [0, -1, 100, "1", undefined])
    assert.equal(
      classify({}, { botManagement: { score } }).traffic_signals.cf_score,
      null,
    );
  for (const cf of [
    undefined,
    { botManagement: { jsDetection: { passed: false }, corporateProxy: true } },
    { asOrganization: "Microsoft Corporation", asn: 8075 },
  ]) {
    assert.equal(classify(browserHeaders, cf).classification, "human");
  }
  assert.equal(
    classify({
      "user-agent": "Mozilla/5.0 Safari/605.1",
      accept: "text/html",
      "accept-language": "pt-BR",
    }).classification,
    "unknown",
  );
  assert.equal(
    classify(browserHeaders, undefined, 100).classification,
    "unknown",
  ); // shared NAT alone is insufficient
  assert.equal(classify({}, undefined, 100).classification, "probable_bot");
});
test("metadata is bounded and unavailable values are null", () => {
  const value = collectTraffic(
    request({
      "user-agent": "a".repeat(4000),
      referer: "x".repeat(4000),
      "x-forwarded-for": "1.2.3.4",
    }),
  );
  assert.equal(value.user_agent.length, 2048);
  assert.equal(value.referer.length, 2048);
  assert.equal(value.ip, null);
  assert.equal(value.signals.verified_bot, null);
});
async function fixture(h) {
  const domain = await (
    await h.call("domains", "POST", { hostname: "links.example.com" })
  ).json();
  h.db.prepare("UPDATE domains SET verified=1 WHERE id=?").run(domain.id);
  return (
    await h.call("links", "POST", {
      name: "Tráfego",
      slug: "traffic",
      mode: "real",
      device: "all",
      real_urls: ["https://example.com/real"],
      waiting_url: "https://example.com/waiting",
    })
  ).json();
}
test("D1 migration, persistence, frequency, API filters, aggregates, cursors and legacy rows", async () => {
  const h = await harness();
  try {
    const link = await fixture(h);
    async function visit(headers, cf, method = "GET") {
      const pending = [];
      const res = await redirect.fetch(request(headers, cf, method), h.env, {
        waitUntil: (p) => pending.push(p),
      });
      await Promise.all(pending);
      assert.equal(res.headers.get("location"), "https://example.com/real");
    }
    await visit(browserHeaders);
    await visit(
      {
        "user-agent": "Facebot",
        "cf-connecting-ip": "203.0.113.1",
        "cf-ray": "abc-GRU",
        referer: "https://example.com/",
      },
      { country: "BR", asn: 32934 },
      "HEAD",
    );
    await visit(
      { "user-agent": "Googlebot" },
      { botManagement: { verifiedBot: true, score: 1, ja4: "test" } },
    );
    h.db
      .prepare(
        "INSERT INTO clicks(link_id,hostname,device,destination,country) VALUES(?, 'links.example.com','desktop','real','XX')",
      )
      .run(link.id);
    let logs = await (await h.call("logs")).json();
    assert.equal(logs.items[0].classification, "unknown");
    assert.equal(logs.items[0].bot_confidence, null);
    assert.equal(logs.items[0].is_bot, null);
    assert.deepEqual(logs.items[0].bot_reason, []);
    const head = logs.items.find((r) => r.request_method === "HEAD");
    assert.equal(head.asn, 32934);
    assert.equal(head.ip, "203.0.113.1");
    assert.equal(head.cf_ray, "abc-GRU");
    assert.equal(head.country, "BR");
    assert.equal(head.traffic_signals.recent_requests_60s, 0);
    const metrics = await (await h.call("analytics")).json();
    assert.equal(metrics.summary.total, 4);
    assert.equal(metrics.summary.automated, 2);
    assert.equal(metrics.summary.automated_percent, 50);
    for (const filter of [
      "classification=probable_bot",
      "bot_provider=meta",
      "request_method=HEAD",
    ]) {
      const result = await (await h.call("analytics?" + filter)).json();
      assert.equal(result.summary.total, 1);
      assert.equal(result.summary.automated_percent, 100);
      assert.equal(
        (await (await h.call("logs?" + filter)).json()).items[0].id,
        head.id,
      );
    }
    assert.equal(
      (await (await h.call("analytics?hostname=absent.example")).json()).summary
        .automated_percent,
      0,
    );
    for (const endpoint of ["logs", "analytics"]) {
      assert.equal(
        (await h.call(endpoint + "?classification=invalid")).status,
        400,
      );
      assert.equal(
        (await h.call(endpoint + "?bot_provider=%27%20OR%201=1")).status,
        400,
      );
      assert.equal(
        (await h.call(endpoint + "?request_method=POST")).status,
        400,
      );
    }
    for (let i = 0; i < 101; i++) {
      h.db
        .prepare(
          "INSERT INTO clicks(link_id,hostname,device,destination,country,ip) VALUES(?, 'links.example.com','desktop','real','XX','203.0.113.2')",
        )
        .run(link.id);
    }
    await visit({ "cf-connecting-ip": "203.0.113.2" });
    logs = await (await h.call("logs?classification=probable_bot")).json();
    assert.equal(logs.items[0].traffic_signals.recent_requests_60s, 100);
    assert.equal(logs.items[0].bot_provider, "unknown");
    const page = await (await h.call("logs?classification=unknown")).json();
    const next = await (
      await h.call("logs?classification=unknown&cursor=" + page.next_cursor)
    ).json();
    assert.equal(page.items.length, 50);
    assert.equal(next.items.length, 50);
    assert.equal(
      new Set([...page.items, ...next.items].map((r) => r.id)).size,
      100,
    );
  } finally {
    h.close();
  }
});
test("bot evidence and analytics failures cannot change Real/Espera or rendered content", async () => {
  const h = await harness();
  try {
    const link = await fixture(h);
    for (const mode of ["real", "waiting"])
      for (const device of ["all", "mobile", "desktop"])
        for (const mobile of [true, false]) {
          h.db
            .prepare("UPDATE links SET mode=?,device=?,version=? WHERE id=?")
            .run(mode, device, crypto.randomUUID(), link.id);
          for (const verified of [true, false]) {
            const pending = [];
            const r = request(
              { "user-agent": mobile ? "iPhone Googlebot" : "Googlebot" },
              { botManagement: { verifiedBot: verified } },
            );
            const res = await redirect.fetch(r, h.env, {
              waitUntil: (p) => pending.push(p),
            });
            await Promise.all(pending);
            const expected =
              mode === "real" &&
              (device === "all" || device === (mobile ? "mobile" : "desktop"))
                ? "real"
                : "waiting";
            assert.equal(
              res.headers.get("location"),
              "https://example.com/" + expected,
            );
          }
        }
    const originalPrepare = h.env.DB.prepare;
    h.env.DB.prepare = (sql) => {
      if (
        sql.startsWith("INSERT INTO clicks") ||
        sql.includes("SELECT COUNT(*) AS total")
      )
        throw new Error("simulated analytics outage");
      return originalPrepare(sql);
    };
    const pending = [];
    const res = await redirect.fetch(
      request({ "cf-connecting-ip": "203.0.113.3" }),
      h.env,
      { waitUntil: (p) => pending.push(p) },
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://example.com/waiting");
    await Promise.all(pending); // failure handled, no rejected waitUntil
  } finally {
    h.close();
  }
});

test("migration preserves populated historical clicks and query uses frequency index", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync, readdirSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((f) => f.endsWith(".sql") && f < "0005")
      .sort())
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    db.exec(
      "INSERT INTO clicks(link_id,hostname,device,destination,country,link_name,slug) VALUES('deleted','links.example.com','desktop','waiting','BR','Histórico','antigo')",
    );
    db.exec(readFileSync(new URL("0005_bot_analytics.sql", directory), "utf8"));
    const row = db.prepare("SELECT * FROM clicks").get();
    assert.equal(row.link_name, "Histórico");
    assert.equal(row.classification, "unknown");
    assert.equal(row.is_bot, null);
    assert.equal(row.bot_confidence, null);
    assert.equal(row.request_method, "GET");
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM clicks WHERE hostname=? AND ip=? AND created_at>=? AND created_at<=? LIMIT 100",
      )
      .all("links.example.com", "203.0.113.1", "2026-01-01", "2026-01-02");
    assert.match(JSON.stringify(plan), /clicks_origin_rate/);
  } finally {
    db.close();
  }
});
