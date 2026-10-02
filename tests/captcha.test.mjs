import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import redirect from "../workers/redirect.mjs";
import {
  createCaptchaSession,
  validCaptchaSession,
} from "../workers/captcha.mjs";

const payload = {
  name: "Captcha test",
  slug: "captcha-test",
  mode: "real",
  device: "mobile",
  real_urls: ["https://example.com/real"],
  waiting_url: "https://example.com/wait",
};
const origin = "https://links.example.com";
async function setup(enabled = true) {
  const h = await harness();
  Object.assign(h.env, {
    TURNSTILE_SITE_KEY: "public-key",
    TURNSTILE_SECRET_KEY: "private-secret",
    CAPTCHA_SESSION_SECRET: "a-test-session-secret-at-least-32-characters",
  });
  const domain = await (
    await h.call("domains", "POST", { hostname: "links.example.com" })
  ).json();
  await h.env.DB.prepare("UPDATE domains SET verified=1 WHERE id=?")
    .bind(domain.id)
    .run();
  const link = await (
    await h.call("links", "POST", { ...payload, captcha_enabled: enabled })
  ).json();
  async function visit(options = {}, overrides = {}) {
    const pending = [];
    const response = await redirect.fetch(
      new Request(origin + "/captcha-test", options),
      { ...h.env, ...overrides },
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    return response;
  }
  return { ...h, link, visit };
}
function post(token = "dummy-token", headers = {}) {
  return {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "iPhone",
      ...headers,
    },
    body: new URLSearchParams({ "cf-turnstile-response": token }).toString(),
  };
}
async function challenge(h) {
  const response = await h.visit();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  const html = await response.text();
  assert.match(html, /Você não é um robô/);
  assert.match(html, /challenges.cloudflare.com\/turnstile\/v0\/api.js/);
  assert.ok(!html.includes(h.env.TURNSTILE_SECRET_KEY));
  assert.ok(!html.includes(h.env.CAPTCHA_SESSION_SECRET));
  assert.match(
    response.headers.get("Content-Security-Policy"),
    /form-action 'self'/,
  );
  assert.equal(response.headers.get("Referrer-Policy"), "same-origin");
  return html.match(/data-cdata="([^"]+)"/)[1];
}
function siteverify(h, cdata, result = {}) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify")
      return previous(url, options);
    const body = JSON.parse(options.body);
    assert.equal(body.secret, h.env.TURNSTILE_SECRET_KEY);
    assert.equal(options.method, "POST");
    assert.ok(options.signal);
    return Response.json({
      success: true,
      hostname: "links.example.com",
      action: "cloak_link",
      cdata,
      ...result,
    });
  };
}
test("captcha CRUD defaults off, strict validation and older-client updates preserve protection", async () => {
  const h = await setup(false);
  try {
    assert.equal(h.link.captcha_enabled, false);
    const old = await (
      await h.call("links", "POST", { ...payload, slug: "old-client" })
    ).json();
    assert.equal(old.captcha_enabled, false);
    assert.equal(
      (await h.call("links", "POST", { ...payload, captcha_enabled: "false" }))
        .status,
      400,
    );
    await h.call("links/" + h.link.id, "PUT", {
      ...payload,
      captcha_enabled: true,
    });
    await h.call("links/" + h.link.id, "PUT", payload);
    const links = await (await h.call("links")).json();
    assert.equal(links.find((l) => l.id === h.link.id).captcha_enabled, true);
  } finally {
    h.close();
  }
});
test("disabled captcha retains redirects, waiting HTML, HEAD and analytics without configuration", async () => {
  const h = await setup(false);
  try {
    const missing = {
      TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: undefined,
      CAPTCHA_SESSION_SECRET: undefined,
    };
    for (const [ua, destination] of [
      ["iPhone", "real"],
      ["Windows", "wait"],
      ["Googlebot", "wait"],
    ]) {
      const r = await h.visit({ headers: { "User-Agent": ua } }, missing);
      assert.equal(r.status, 302);
      assert.equal(
        r.headers.get("location"),
        "https://example.com/" + destination,
      );
      assert.equal(r.headers.get("set-cookie"), null);
    }
    assert.equal((await h.visit({ method: "HEAD" }, missing)).status, 302);
    assert.equal((await h.visit(post(), missing)).status, 405);
    assert.equal((await (await h.call("analytics")).json()).summary.total, 4);
    await h.call("links/" + h.link.id, "PUT", {
      ...payload,
      mode: "waiting",
      waiting_url: "",
    });
    assert.match(
      await (await h.visit({}, missing)).text(),
      /Conheça nosso trabalho/,
    );
  } finally {
    h.close();
  }
});
test("verified token follows normal device rules, signs session and does not duplicate click for POST", async () => {
  const h = await setup();
  try {
    const cdata = await challenge(h);
    siteverify(h, cdata);
    const passed = await h.visit(post());
    assert.equal(passed.status, 302);
    assert.equal(passed.headers.get("location"), payload.real_urls[0]);
    const cookie = passed.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    assert.match(cookie, /Max-Age=300/);
    const reload = await h.visit(
      post("already-used", { Cookie: cookie.split(";")[0] }),
    );
    assert.equal(reload.headers.get("location"), payload.real_urls[0]);
    assert.equal((await (await h.call("analytics")).json()).summary.total, 1);
    for (const [ua, target] of [
      ["iPhone", payload.real_urls[0]],
      ["Windows", payload.waiting_url],
      ["Googlebot", payload.waiting_url],
    ]) {
      const r = await h.visit({
        headers: { Cookie: cookie.split(";")[0], "User-Agent": ua },
      });
      assert.equal(r.headers.get("location"), target);
    }
    assert.equal(
      (
        await h.visit({
          method: "HEAD",
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      302,
    );
    // Editing the link changes its version and invalidates cached content and old sessions.
    await h.call("links/" + h.link.id, "PUT", {
      ...payload,
      captcha_enabled: true,
      mode: "waiting",
      waiting_url: "",
    });
    const changed = await h.visit({
      headers: { Cookie: cookie.split(";")[0] },
    });
    assert.match(await changed.text(), /Você não é um robô/);
    const newCdata = await challenge(h);
    siteverify(h, newCdata);
    const waiting = await h.visit(post());
    assert.equal(waiting.status, 200);
    assert.match(await waiting.text(), /Conheça nosso trabalho/);
    assert.ok(waiting.headers.get("set-cookie"));
    await h.call("links/" + h.link.id, "PUT", {
      ...payload,
      captcha_enabled: false,
    });
    assert.equal((await h.visit()).status, 302);
  } finally {
    h.close();
  }
});
test("session rejects tampering, expiry, future expiry, other links, versions and hostnames", async () => {
  const link = { id: "test-id", version: "v1" },
    secret = "session-secret-at-least-32-characters",
    now = Date.now();
  const cookie = (
    await createCaptchaSession(link, "links.example.com", secret, now)
  ).split(";")[0];
  const request = (host = origin, value = cookie) =>
    new Request(host + "/test", { headers: { Cookie: value } });
  assert.equal(await validCaptchaSession(request(), link, secret, now), true);
  assert.equal(
    await validCaptchaSession(request(), link, secret, now + 300000),
    false,
  );
  assert.equal(
    await validCaptchaSession(request(), link, secret, now - 10000),
    false,
  );
  assert.equal(
    await validCaptchaSession(
      request("https://other.example.com"),
      link,
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    await validCaptchaSession(
      request(),
      { ...link, id: "another" },
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    await validCaptchaSession(
      request(),
      { ...link, version: "v2" },
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    await validCaptchaSession(request(origin, cookie + "x"), link, secret, now),
    false,
  );
  assert.equal(
    await validCaptchaSession(request(), link, "wrong-key", now),
    false,
  );
});
test("failures, wrong bindings, replay, missing config and bad requests fail closed without logging secrets", async () => {
  const h = await setup(),
    logs = [],
    previousInfo = console.info;
  console.info = (line) => logs.push(line);
  try {
    const cdata = await challenge(h);
    for (const result of [
      { success: false },
      { hostname: "attacker.example" },
      { action: "other" },
      { cdata: "other-link" },
      { success: false, "error-codes": ["timeout-or-duplicate"] },
    ]) {
      siteverify(h, cdata, result);
      const response = await h.visit(post("sensitive-turnstile-token"));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    for (const name of [
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "CAPTCHA_SESSION_SECRET",
    ])
      assert.equal((await h.visit({}, { [name]: undefined })).status, 503);
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("siteverify")) {
        calls++;
        throw new Error("network");
      }
      return original(url, options);
    };
    assert.equal((await h.visit(post("", {}))).status, 400);
    assert.equal((await h.visit(post("x".repeat(10000)))).status, 400);
    assert.equal(
      (await h.visit(post("token", { Origin: "https://evil.example" }))).status,
      403,
    );
    assert.equal(
      (await h.visit(post("token", { "Content-Type": "application/json" })))
        .status,
      400,
    );
    assert.equal(calls, 0);
    assert.equal((await h.visit(post())).status, 503);
    assert.equal(calls, 1);
    const head = await h.visit({ method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const serialized = logs.join("\n");
    assert.match(serialized, /captcha_shown/);
    assert.match(serialized, /captcha_failed/);
    for (const value of [
      "sensitive-turnstile-token",
      h.env.TURNSTILE_SECRET_KEY,
      h.env.CAPTCHA_SESSION_SECRET,
    ])
      assert.ok(!serialized.includes(value));
  } finally {
    console.info = previousInfo;
    h.close();
  }
});
