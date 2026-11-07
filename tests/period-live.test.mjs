import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import { periodQuery } from "../src/period.mjs";

test("local calendar presets include today, yesterday, month/year rollover and daylight saving", () => {
  const oldTZ = process.env.TZ;
  try {
    process.env.TZ = "America/Bahia";
    const now = new Date("2026-01-01T15:00:00Z");
    const range = (preset, date = now) =>
      Object.fromEntries(new URLSearchParams(periodQuery({ preset }, date)));
    assert.deepEqual(range("1"), {
      from: "2026-01-01T03:00:00.000Z",
      to: "2026-01-02T03:00:00.000Z",
    });
    assert.deepEqual(range("yesterday"), {
      from: "2025-12-31T03:00:00.000Z",
      to: "2026-01-01T03:00:00.000Z",
    });
    assert.equal(range("7").from, "2025-12-26T03:00:00.000Z");
    assert.equal(range("30").from, "2025-12-03T03:00:00.000Z");
    assert.equal(
      range("1", new Date("2026-01-02T03:00:00Z")).from,
      "2026-01-02T03:00:00.000Z",
    );
    assert.equal(periodQuery({ preset: "all" }), "period=all");
    assert.equal(
      periodQuery({ preset: "custom", from: "2026-01-01", to: "2026-01-01" }),
      periodQuery({ preset: "1" }, now),
    );
    assert.equal(periodQuery({ preset: "custom", from: "", to: "" }), "");
    assert.equal(
      periodQuery({ preset: "custom", from: "2026-01-02", to: "2026-01-01" }),
      "",
    );
    process.env.TZ = "America/New_York";
    assert.deepEqual(range("1", new Date("2026-03-08T15:00:00Z")), {
      from: "2026-03-08T05:00:00.000Z",
      to: "2026-03-09T04:00:00.000Z",
    });
    assert.deepEqual(range("yesterday", new Date("2026-11-02T15:00:00Z")), {
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-02T05:00:00.000Z",
    });
  } finally {
    if (oldTZ === undefined) delete process.env.TZ;
    else process.env.TZ = oldTZ;
  }
});

test("link counters, analytics, history and domain totals agree for each period and include new accesses", async () => {
  const h = await harness();
  const oldTZ = process.env.TZ;
  process.env.TZ = "America/Bahia";
  try {
    const domain = await (
      await h.call("domains", "POST", { hostname: "period.example.com" })
    ).json();
    const makeLink = (name) =>
      h
        .call("links", "POST", {
          name,
          slug: name,
          mode: "waiting",
          device: "all",
          real_urls: [],
          waiting_url: "",
          domain_id: domain.id,
        })
        .then((r) => r.json());
    const link = await makeLink("period"),
      empty = await makeLink("empty");
    const now = new Date("2026-01-15T15:00:00Z");
    const insert = h.db.prepare(
      "INSERT INTO clicks(link_id,hostname,device,destination,country,created_at) VALUES(?,?,'mobile','waiting','BR',?)",
    );
    const add = (date) => insert.run(link.id, domain.hostname, date);
    for (const date of [
      "2020-01-01T00:00:00.000Z",
      "2025-12-17T03:00:00.000Z",
      "2026-01-09T03:00:00.000Z",
      "2026-01-14T03:00:00.000Z",
      "2026-01-15T02:59:59.999Z",
      "2026-01-15T03:00:00.000Z",
      "2026-01-16T02:59:59.999Z",
      "2026-01-16T03:00:00.000Z",
    ])
      add(date);
    for (const [preset, total] of [
      ["1", 2],
      ["yesterday", 2],
      ["7", 5],
      ["30", 6],
      ["all", 8],
    ]) {
      const query = periodQuery({ preset }, now);
      const response = await h.call("links?" + query);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const links = await response.json();
      assert.equal(links.find((l) => l.id === link.id).clicks, total, preset);
      assert.equal(links.find((l) => l.id === empty.id).clicks, 0);
      const stats = await (await h.call("analytics?" + query)).json();
      assert.equal(stats.summary.total, total, preset);
      assert.equal(
        stats.daily.reduce((sum, d) => sum + d.total, 0),
        total,
      );
      assert.equal(
        (await (await h.call("logs?" + query)).json()).items.length,
        total,
      );
      assert.equal(
        (await (await h.call("domain-health?" + query)).json()).items[0]
          .accesses,
        total,
      );
    }
    add("2026-01-15T16:00:00.000Z");
    const today = periodQuery({ preset: "1" }, now);
    assert.equal(
      (await (await h.call("links?" + today)).json()).find(
        (l) => l.id === link.id,
      ).clicks,
      3,
    );
    assert.equal(
      (await (await h.call("analytics?" + today)).json()).summary.total,
      3,
    );
    const all = await (
      await h.call("analytics?period=all&link=" + link.id)
    ).json();
    assert.equal(all.summary.total, 9);
    assert.equal(all.from, "2020-01-01T00:00:00.000Z");
    const noHits = await (
      await h.call("analytics?period=all&link=" + empty.id)
    ).json();
    assert.equal(noHits.summary.total, 0);
    assert.equal(noHits.days, 1);
    // Legacy clients still receive lifetime counts when no filter is sent.
    assert.equal(
      (await (await h.call("links")).json()).find((l) => l.id === link.id)
        .clicks,
      9,
    );
    assert.equal((await h.call("links?from=bad&to=bad")).status, 400);
    for (const endpoint of [
      "links",
      "analytics",
      "logs",
      "domain-health",
      "captcha-events",
    ])
      assert.equal(
        (await h.call(endpoint + "?period=all&from=2026-01-01")).status,
        400,
      );
    const plan = h.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM clicks WHERE link_id=? AND created_at>=? AND created_at<?",
      )
      .all(link.id, "2026", "2027");
    assert.ok(plan.some((row) => /INDEX.*clicks_link_date/.test(row.detail)));
  } finally {
    h.close();
    if (oldTZ === undefined) delete process.env.TZ;
    else process.env.TZ = oldTZ;
  }
});
