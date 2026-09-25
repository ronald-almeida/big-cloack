import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import {
  deviceType,
  destinationMode,
  validateLink,
  analyticsSince,
} from "../workers/rules.mjs";
import redirect from "../workers/redirect.mjs";
import api from "../workers/api.mjs";
import { onRequest } from "../functions/[[path]].js";
test("device matrix and destination validation", () => {
  assert.equal(
    analyticsSince(7, Date.parse("2026-09-24T21:00:00Z")),
    "2026-09-18T00:00:00.000Z",
  );
  assert.equal(
    analyticsSince(30, Date.parse("2026-03-01T03:00:00Z")),
    "2026-01-31T00:00:00.000Z",
  );
  for (const mode of ["real", "waiting"])
    for (const setting of ["all", "mobile", "desktop"])
      for (const actual of ["mobile", "desktop"])
        assert.equal(
          destinationMode({ mode, device: setting }, actual),
          mode === "real" && (setting === "all" || setting === actual)
            ? "real"
            : "waiting",
        );
  assert.equal(deviceType(new Headers({ "User-Agent": "iPad" })), "mobile");
  assert.equal(
    deviceType(new Headers({ "User-Agent": "Mozilla Windows" })),
    "desktop",
  );
  assert.equal(
    deviceType(new Headers({ "User-Agent": "Googlebot" })),
    "desktop",
  );
  assert.throws(() =>
    validateLink({
      name: "x",
      mode: "real",
      device: "all",
      real_urls: ["javascript:alert(1)"],
    }),
  );
  assert.throws(() =>
    validateLink({ name: "x", mode: "real", device: "all", real_urls: [] }),
  );
  assert.match(
    validateLink({ name: "x", mode: "waiting", device: "all", real_urls: [] })
      .slug,
    /^[a-z0-9]{10}$/,
  );
});
test("authenticated CRUD, redirects, analytics, cache invalidation and security", async () => {
  const h = await harness();
  try {
    const pageResponse = await onRequest({
      request: new Request("https://aprovabmyksh.com/", {
        headers: { "Cf-Access-Jwt-Assertion": h.jwt },
      }),
      env: h.env,
      next: () => new Response("<html>private</html>"),
    });
    assert.equal(await pageResponse.text(), "<html>private</html>");
    assert.equal(pageResponse.headers.get("Cache-Control"), "no-store");
    assert.match(
      pageResponse.headers.get("Content-Security-Policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal(
      (
        await api.fetch(
          new Request("https://aprovabmyksh.com/api/links"),
          h.env,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await onRequest({
          request: new Request("https://preview.pages.dev/"),
          env: h.env,
          next: () => new Response("private"),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call("links", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": await h.token({
            email: "other@example.com",
          }),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call("links", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": await h.token({ aud: "wrong" }),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call("links", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": await h.token({ exp: 1 }),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call("links", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": "invalid-token",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call(
          "links",
          "POST",
          {},
          { Origin: "https://attacker.example" },
        )
      ).status,
      403,
    );
    const payload = {
      name: "Lançamento",
      slug: "launch",
      mode: "real",
      device: "mobile",
      real_urls: ["https://example.com/a", "https://example.com/b"],
      waiting_url: "https://example.com/wait",
    };
    let response = await h.call("links", "POST", payload);
    assert.equal(response.status, 201);
    const link = await response.json();
    assert.equal((await h.call("links", "POST", payload)).status, 409);
    assert.equal((await h.call("links")).status, 200);
    const domain = await (
      await h.call("domains", "POST", { hostname: "links.example.com" })
    ).json();
    const pending = [];
    const ctx = {
      waitUntil(p) {
        pending.push(p);
      },
    };
    const visit = (ua = "iPhone", method = "GET", host = "links.example.com") =>
      redirect.fetch(
        new Request("https://" + host + "/launch", {
          method,
          headers: { "User-Agent": ua },
        }),
        h.env,
        ctx,
      );
    assert.equal((await visit()).status, 404);
    await h.env.DB.prepare("UPDATE domains SET verified=1 WHERE id=?")
      .bind(domain.id)
      .run();
    assert.equal(
      (await visit("Windows")).headers.get("location"),
      payload.waiting_url,
    );
    assert.ok(
      payload.real_urls.includes((await visit()).headers.get("location")),
    );
    assert.equal(
      (await visit("Googlebot")).headers.get("location"),
      payload.waiting_url,
    );
    assert.equal((await visit("iPhone", "HEAD")).status, 302);
    assert.equal((await visit("iPhone", "POST")).status, 405);
    assert.equal(
      (await visit("iPhone", "GET", "unknown.example.com")).status,
      404,
    );
    await Promise.all(pending);
    pending.length = 0;
    let metrics = await (await h.call("analytics")).json();
    assert.equal(metrics.summary.total, 4);
    assert.equal(metrics.summary.real, 2);
    assert.equal(metrics.summary.waiting, 2);
    assert.equal(metrics.summary.mobile, 2);
    assert.equal(
      (
        await h.call("links/" + link.id, "PUT", {
          ...payload,
          mode: "waiting",
          waiting_url: "",
        })
      ).status,
      200,
    );
    response = await visit();
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Conheça nosso trabalho/);
    await Promise.all(pending);
    assert.equal((await h.call("links/" + link.id, "DELETE")).status, 200);
    assert.equal((await visit()).status, 404);
    assert.equal((await (await h.call("analytics")).json()).summary.total, 5);
    assert.equal((await h.call("domains/" + domain.id, "DELETE")).status, 200);
  } finally {
    h.close();
  }
});
