import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import redirect from "../workers/redirect.mjs";
import { issueSession, validSession } from "../workers/captcha.mjs";
import { validateLink } from "../workers/rules.mjs";

const config = {
  name: "Teste",
  slug: "pasta/oferta",
  mode: "real",
  device: "mobile",
  real_urls: ["https://example.com/real"],
  waiting_url: "https://example.com/waiting",
  captcha_enabled: 1,
};
async function fixture() {
  const h = await harness();
  h.authFetch = globalThis.fetch;
  h.db.exec(
    "INSERT INTO domains(id,hostname,verified) VALUES('domain','links.example.com',1),('other','other.example.com',1)",
  );
  const response = await h.call("links", "POST", config);
  assert.equal(response.status, 201);
  h.link = await response.json();
  Object.assign(h.env, {
    TURNSTILE_SITE_KEY: "public-test-key",
    TURNSTILE_SECRET_KEY: "private-test-key",
    CAPTCHA_SESSION_SECRET: "s".repeat(48),
  });
  h.visit = async (
    options = {},
    host = "links.example.com",
    slug = config.slug,
  ) => {
    const pending = [];
    const response = await redirect.fetch(
      new Request(`https://${host}/${slug}?utm_source=teste`, options),
      h.env,
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    return response;
  };
  h.post = (token, headers = {}) => ({
    method: "POST",
    headers: {
      origin: "https://links.example.com",
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams({ "cf-turnstile-response": token }),
  });
  return h;
}
function stubVerification(h, scope, override = {}) {
  globalThis.fetch = async (url, options) => {
    if (
      String(url) !==
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    )
      return h.authFetch(url, options);
    assert.equal(
      String(url),
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    const body = JSON.parse(options.body);
    assert.equal(body.secret, h.env.TURNSTILE_SECRET_KEY);
    assert.equal(options.method, "POST");
    return Response.json({
      success: true,
      hostname: "links.example.com",
      action: "cloak-link",
      cdata: scope,
      ...override,
    });
  };
}
async function challenge(h) {
  const response = await h.visit();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Você não é um robô/);
  assert.match(
    html,
    /https:\/\/challenges.cloudflare.com\/turnstile\/v0\/api.js/,
  );
  assert.ok(!html.includes(h.env.TURNSTILE_SECRET_KEY));
  assert.ok(!html.includes(h.env.CAPTCHA_SESSION_SECRET));
  assert.match(
    response.headers.get("content-security-policy"),
    /form-action 'self'/,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  return /data-cdata="([^"]+)"/.exec(html)[1];
}
test("captcha off preserves routing, HEAD, click analytics and rejects POST without configuration", async () => {
  const h = await fixture();
  try {
    assert.equal(
      (
        await h.call("links/" + h.link.id, "PUT", {
          ...config,
          captcha_enabled: 0,
        })
      ).status,
      200,
    );
    delete h.env.TURNSTILE_SECRET_KEY;
    for (const [ua, target] of [
      ["iPhone", "real"],
      ["Googlebot", "waiting"],
    ]) {
      const r = await h.visit({ headers: { "user-agent": ua } });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get("location"), "https://example.com/" + target);
    }
    assert.equal((await h.visit({ method: "HEAD" })).status, 302);
    assert.equal((await h.visit(h.post("ignored"))).status, 405);
    assert.equal(
      h.db.prepare("SELECT COUNT(*) n FROM captcha_events").get().n,
      0,
    );
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM clicks").get().n, 3);
  } finally {
    h.close();
  }
});
test("challenge -> Siteverify -> signed cookie -> original device rules; session skips repeat and POST preserves query", async () => {
  const h = await fixture();
  try {
    const scope = await challenge(h);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM clicks").get().n, 0);
    stubVerification(h, scope);
    const r = await h.visit(h.post("private-token"));
    assert.equal(r.status, 303);
    assert.equal(
      r.headers.get("location"),
      "https://links.example.com/pasta/oferta?utm_source=teste",
    );
    const set = r.headers.get("set-cookie");
    for (const attr of [
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Max-Age=300",
      "Path=/",
    ])
      assert.ok(set.includes(attr));
    assert.ok(!set.includes("Domain="));
    const cookie = set.split(";")[0];
    globalThis.fetch = (url, options) => {
      if (String(url).includes("/siteverify"))
        throw new Error("must not verify twice");
      return h.authFetch(url, options);
    };
    for (const [ua, target] of [
      ["iPhone", "real"],
      ["Googlebot", "waiting"],
    ]) {
      const next = await h.visit({ headers: { cookie, "user-agent": ua } });
      assert.equal(next.status, 302);
      assert.equal(
        next.headers.get("location"),
        "https://example.com/" + target,
      );
    }
    const rows = h.db.prepare("SELECT * FROM captcha_events").all();
    assert.deepEqual(
      rows.map((r) => r.event),
      ["captcha_shown", "captcha_passed"],
    );
    assert.ok(!JSON.stringify(rows).includes("private-token"));
    const events = await (await h.call("captcha-events")).json();
    assert.equal(events.items.length, 2);
    assert.equal(
      (
        await h.call("captcha-events", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": "bad",
        })
      ).status,
      401,
    );
  } finally {
    h.close();
  }
});
test("failed, expired, replayed, wrong-host/action/context tokens and upstream failures allow retry without cookie", async () => {
  const h = await fixture();
  try {
    const scope = await challenge(h);
    for (const override of [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      { hostname: "other.example.com" },
      { action: "other" },
      { cdata: "other" },
      { success: "true" },
    ]) {
      stubVerification(h, scope, override);
      const r = await h.visit(h.post("rejected-token"));
      assert.equal(r.status, 400);
      assert.equal(r.headers.get("set-cookie"), null);
      assert.match(await r.text(), /nova tentativa/);
    }
    globalThis.fetch = async () => {
      throw new Error("timeout");
    };
    assert.equal((await h.visit(h.post("token"))).status, 503);
    stubVerification(h, scope);
    assert.equal((await h.visit(h.post("fresh-token"))).status, 303);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM clicks").get().n, 0);
    assert.equal(
      h.db
        .prepare(
          "SELECT COUNT(*) n FROM captcha_events WHERE event='captcha_failed'",
        )
        .get().n,
      6,
    );
  } finally {
    h.close();
  }
});
test("tampered/expired cookies, other hostname/slug and changed link version require verification again", async () => {
  const h = await fixture();
  try {
    const scope = await challenge(h);
    stubVerification(h, scope);
    const r = await h.visit(h.post("token")),
      cookie = r.headers.get("set-cookie").split(";")[0],
      name = cookie.split("=")[0];
    const expired = await issueSession(
      h.env.CAPTCHA_SESSION_SECRET,
      scope,
      Date.now() - 301000,
    );
    for (const value of [name + "=bad", cookie + "x", name + "=" + expired])
      assert.equal((await h.visit({ headers: { cookie: value } })).status, 200);
    assert.equal(
      (await h.visit({ headers: { cookie } }, "other.example.com")).status,
      200,
    );
    const second = await h.call("links", "POST", {
      ...config,
      slug: "another/link",
    });
    assert.equal(second.status, 201);
    assert.equal(
      (
        await h.visit(
          { headers: { cookie } },
          "links.example.com",
          "another/link",
        )
      ).status,
      200,
    );
    assert.equal(
      (await h.call("links/" + h.link.id, "PUT", config)).status,
      200,
    );
    assert.equal((await h.visit({ headers: { cookie } })).status, 200);
  } finally {
    h.close();
  }
});
test("configuration missing fails closed; HEAD, invalid origins and bounded payload never grant session", async () => {
  const h = await fixture();
  try {
    const head = await h.visit({ method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    globalThis.fetch = () => {
      throw new Error("must not call verifier");
    };
    for (const options of [
      h.post("token", { origin: "https://evil.example" }),
      h.post(""),
      h.post("a".repeat(9000)),
    ]) {
      const r = await h.visit(options);
      assert.equal(r.status, 400);
      assert.equal(r.headers.get("set-cookie"), null);
    }
    for (const key of [
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "CAPTCHA_SESSION_SECRET",
    ]) {
      const value = h.env[key];
      delete h.env[key];
      assert.equal((await h.visit()).status, 503);
      h.env[key] = value;
    }
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM clicks").get().n, 0);
  } finally {
    h.close();
  }
});
test("older clients preserve captcha and approved sessions reach the internal waiting page", async () => {
  const h = await fixture();
  try {
    const { captcha_enabled, ...input } = config;
    const saved = await h.call("links/" + h.link.id, "PUT", {
      ...input,
      mode: "waiting",
      waiting_url: "",
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).captcha_enabled, 1);
    const scope = await challenge(h);
    stubVerification(h, scope);
    const accepted = await h.visit(h.post("token"));
    const cookie = accepted.headers.get("set-cookie").split(";")[0];
    const page = await h.visit({ headers: { cookie } });
    assert.equal(page.status, 200);
    assert.ok(!(await page.text()).includes("cf-turnstile"));
    const head = await h.visit({ method: "HEAD", headers: { cookie } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const repeatPost = await h.visit(h.post("ignored", { cookie }));
    assert.equal(repeatPost.status, 303);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM clicks").get().n, 2);
  } finally {
    h.close();
  }
});
test("session cryptography rejects changed scope, key, expiry and malformed values", async () => {
  const secret = "s".repeat(48),
    now = Date.now(),
    value = await issueSession(secret, "scope", now);
  assert.equal(await validSession(value, secret, "scope", now), true);
  assert.equal(await validSession(value, secret, "scope", now + 300000), false);
  assert.equal(await validSession(value, secret, "other", now), false);
  assert.equal(await validSession(value, "other", "scope", now), false);
  for (const invalid of ["", "a.b.c", "%%%", "a".repeat(2000)])
    assert.equal(await validSession(invalid, secret, "scope", now), false);
});
test("captcha input defaults to off, accepts only boolean/0/1 and preserves nested slugs safely", () => {
  const { captcha_enabled, ...input } = config;
  assert.equal(validateLink(input).captcha_enabled, 0);
  for (const value of [true, 1, false, 0])
    assert.equal(
      validateLink({ ...input, captcha_enabled: value }).captcha_enabled,
      Number(value),
    );
  for (const value of ["false", "1", 2, null, {}])
    assert.throws(() => validateLink({ ...input, captcha_enabled: value }));
  for (const slug of ["../bad", "foo//bar", "/foo", "foo/", "foo/../bar"])
    assert.throws(() => validateLink({ ...input, slug }));
});
