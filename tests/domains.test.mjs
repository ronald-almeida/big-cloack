import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
test("domain connection is authenticated, idempotent and creates no conflicting DNS writes", async () => {
  const h = await harness(),
    fallback = globalThis.fetch,
    calls = [];
  try {
    let d = await (
      await h.call("domains", "POST", { hostname: "links.example.com" })
    ).json();
    assert.equal(
      (await (await h.call("integrations/cloudflare")).json()).configured,
      false,
    );
    assert.equal(
      (await h.call(`domains/${d.id}/connect`, "POST", {})).status,
      400,
    );
    h.env.CLOUDFLARE_API_TOKEN = "test-only";
    h.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
    let bound = false,
      conflict = false;
    globalThis.fetch = async (url, options) => {
      const u = new URL(url);
      if (u.host === "local-test.cloudflareaccess.com")
        return fallback(url, options);
      calls.push({
        url: String(url),
        method: options?.method || "GET",
        body: options?.body,
      });
      if (u.host === "links.example.com")
        return Response.json({
          service: "big-cloack-redirect",
          domain_id: d.id,
        });
      if (u.pathname.endsWith("/zones"))
        return Response.json({
          success: true,
          result:
            u.searchParams.get("name") === "example.com"
              ? [
                  {
                    id: "zone1",
                    name: "example.com",
                    status: "active",
                    account: { id: h.env.CLOUDFLARE_ACCOUNT_ID },
                  },
                ]
              : [],
        });
      if (u.pathname.endsWith("/dns_records"))
        return Response.json({
          success: true,
          result: conflict ? [{ type: "CNAME" }] : [],
        });
      if (u.pathname.endsWith("/workers/domains")) {
        if (options.method === "PUT") {
          bound = true;
          return Response.json({ success: true, result: { id: "binding1" } });
        }
        return Response.json({
          success: true,
          result: bound
            ? [
                {
                  id: "binding1",
                  hostname: d.hostname,
                  service: "big-cloack-redirect",
                },
              ]
            : [],
        });
      }
      throw new Error("Unexpected URL " + url);
    };
    let res = await h.call(`domains/${d.id}/connect`, "POST", {});
    assert.equal(res.status, 200);
    assert.equal((await res.json()).verified, true);
    await h.call(`domains/${d.id}/connect`, "POST", {});
    assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
    const state = await h.env.DB.prepare("SELECT * FROM domains WHERE id=?")
      .bind(d.id)
      .first();
    assert.equal(state.verified, 1);
    assert.equal(state.cloudflare_domain_id, "binding1");
    assert.equal(state.connection_lock_until, 0);
    bound = false;
    conflict = true;
    res = await h.call(`domains/${d.id}/connect`, "POST", {});
    assert.equal(res.status, 400);
    assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
  } finally {
    globalThis.fetch = fallback;
    h.close();
  }
});
test("new zone needs explicit root, returns nameservers and waits for activation", async () => {
  const h = await harness(),
    fallback = globalThis.fetch;
  try {
    h.env.CLOUDFLARE_API_TOKEN = "test-only";
    h.env.CLOUDFLARE_ACCOUNT_ID = "b".repeat(32);
    const d = await (
      await h.call("domains", "POST", { hostname: "go.example.com.br" })
    ).json();
    let posts = 0;
    globalThis.fetch = async (url, options) => {
      const u = new URL(url);
      if (u.host === "local-test.cloudflareaccess.com")
        return fallback(url, options);
      if (u.pathname.endsWith("/zones")) {
        if (options.method === "POST") {
          posts++;
          assert.equal(JSON.parse(options.body).name, "example.com.br");
          return Response.json({
            success: true,
            result: {
              id: "zone2",
              name: "example.com.br",
              status: "pending",
              name_servers: ["one.ns.cloudflare.com", "two.ns.cloudflare.com"],
            },
          });
        }
        return Response.json({ success: true, result: [] });
      }
      throw new Error("Must not bind before DNS activation");
    };
    let response = await h.call(`domains/${d.id}/connect`, "POST", {});
    assert.equal((await response.json()).status, "needs_zone");
    assert.equal(posts, 0);
    response = await h.call(`domains/${d.id}/connect`, "POST", {
      zone_name: "other.com",
    });
    assert.equal(response.status, 400);
    assert.equal(posts, 0);
    response = await h.call(`domains/${d.id}/connect`, "POST", {
      zone_name: "example.com.br",
    });
    const data = await response.json();
    assert.equal(data.status, "nameservers");
    assert.equal(data.nameservers.length, 2);
    assert.equal(posts, 1);
    globalThis.fetch = async (url, options) =>
      new URL(url).host === "local-test.cloudflareaccess.com"
        ? fallback(url, options)
        : Response.json({ success: false }, { status: 403 });
    response = await h.call(`domains/${d.id}/connect`, "POST", {});
    assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes("test-only"));
  } finally {
    globalThis.fetch = fallback;
    h.close();
  }
});
