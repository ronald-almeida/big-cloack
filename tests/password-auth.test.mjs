import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import api from "../workers/api.mjs";
import { onRequest } from "../functions/[[path]].js";
const password = "Uma frase de teste 2026!";
async function setup() {
  const h = await harness();
  h.env.AUTH_PASSWORD_PEPPER = "test-only-random-pepper";
  const request = (path, method = "GET", data, headers = {}) =>
    new Request(h.env.ADMIN_ORIGIN + path, {
      method,
      headers: {
        Origin: h.env.ADMIN_ORIGIN,
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.1",
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const call = (path, method, data, headers) =>
    api.fetch(request(path, method, data, headers), h.env);
  const recover = () =>
    call(
      "/access-recovery/api",
      "POST",
      { password },
      { "Cf-Access-Jwt-Assertion": h.jwt },
    );
  return { ...h, request, call, recover };
}
test("password login, protected API, logout and hashed storage", async () => {
  const h = await setup();
  try {
    assert.equal((await h.call("/api/links")).status, 401);
    assert.equal(
      (await h.call("/access-recovery/api", "POST", { password })).status,
      401,
    );
    const created = await h.recover();
    assert.equal(created.status, 200);
    const raw = created.headers.get("Set-Cookie");
    for (const flag of [
      "__Host-",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Max-Age=604800",
    ])
      assert.ok(raw.includes(flag));
    const cookie = raw.split(";")[0];
    const credential = h.db.prepare("SELECT * FROM admin_credentials").get();
    assert.notEqual(credential.password_hash, password);
    assert.equal(credential.password_hash.length, 64);
    assert.notEqual(
      h.db.prepare("SELECT token_hash FROM admin_sessions").get().token_hash,
      cookie.split("=")[1],
    );
    assert.equal(
      (await h.call("/api/links", "GET", undefined, { Cookie: cookie })).status,
      200,
    );
    assert.equal(
      (await h.call("/api/farm/sites", "GET", undefined, { Cookie: cookie }))
        .status,
      200,
    );
    assert.equal(
      (await h.call("/api/auth/session", "GET", undefined, { Cookie: cookie }))
        .status,
      200,
    );
    assert.equal(
      (
        await h.call("/api/auth/login", "POST", {
          email: h.env.ADMIN_EMAIL,
          password: "wrong",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call("/api/auth/login", "POST", {
          email: "other@example.com",
          password,
        })
      ).status,
      401,
    );
    const login = await h.call("/api/auth/login", "POST", {
      email: h.env.ADMIN_EMAIL.toUpperCase(),
      password,
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("Set-Cookie").split(";")[0];
    assert.equal(
      (
        await h.call("/api/auth/logout", "POST", undefined, {
          Cookie: loginCookie,
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.call("/api/links", "GET", undefined, { Cookie: loginCookie }))
        .status,
      401,
    );
    h.db.prepare("UPDATE admin_sessions SET expires_at=0").run();
    assert.equal(
      (await h.call("/api/links", "GET", undefined, { Cookie: cookie })).status,
      401,
    );
  } finally {
    h.close();
  }
});
test("recovery rejects invalid identity, validates password, revokes previous sessions", async () => {
  const h = await setup();
  try {
    const old = (await h.recover()).headers.get("Set-Cookie").split(";")[0];
    for (const claims of [
      { email: "other@example.com" },
      { aud: "wrong" },
      { exp: 1 },
    ]) {
      assert.equal(
        (
          await h.call(
            "/access-recovery/api",
            "POST",
            { password },
            { "Cf-Access-Jwt-Assertion": await h.token(claims) },
          )
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await h.call(
          "/access-recovery/api",
          "POST",
          { password: "short" },
          { "Cf-Access-Jwt-Assertion": h.jwt },
        )
      ).status,
      400,
    );
    h.env.RECOVERY_ACCESS_AUD = "recovery-aud";
    const newPassword = password + "changed";
    const changed = await h.call(
      "/access-recovery/api",
      "POST",
      { password: newPassword },
      { "Cf-Access-Jwt-Assertion": await h.token({ aud: "recovery-aud" }) },
    );
    assert.equal(changed.status, 200);
    assert.equal(
      (await h.call("/api/links", "GET", undefined, { Cookie: old })).status,
      401,
    );
    assert.equal(
      (
        await h.call("/api/auth/login", "POST", {
          email: h.env.ADMIN_EMAIL,
          password,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call("/api/auth/login", "POST", {
          email: h.env.ADMIN_EMAIL,
          password: newPassword,
        })
      ).status,
      200,
    );
  } finally {
    h.close();
  }
});
test("login rate limits and cross-origin/alternate-host requests fail closed", async () => {
  const h = await setup();
  try {
    await h.recover();
    for (const path of [
      "/api/auth/login",
      "/api/auth/logout",
      "/access-recovery/api",
    ]) {
      assert.equal(
        (
          await h.call(
            path,
            "POST",
            { password, email: h.env.ADMIN_EMAIL },
            { Origin: "https://evil.example" },
          )
        ).status,
        403,
      );
    }
    const alternate = new Request("https://farm.example/api/auth/login", {
      method: "POST",
      headers: { Origin: h.env.ADMIN_ORIGIN },
    });
    assert.equal((await api.fetch(alternate, h.env)).status, 403);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await h.call("/api/auth/login", "POST", {
            password: "wrong",
            email: h.env.ADMIN_EMAIL,
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await h.call("/api/auth/login", "POST", {
          password,
          email: h.env.ADMIN_EMAIL,
        })
      ).status,
      429,
    );
    h.db.prepare("UPDATE admin_login_limits SET attempts=0").run();
    assert.equal(
      (
        await h.call("/api/auth/login", "POST", {
          password,
          email: h.env.ADMIN_EMAIL,
        })
      ).status,
      200,
    );
    h.db
      .prepare(
        "UPDATE admin_login_limits SET attempts=60 WHERE bucket LIKE 'account:%'",
      )
      .run();
    assert.equal(
      (
        await h.call(
          "/api/auth/login",
          "POST",
          { password, email: h.env.ADMIN_EMAIL },
          { "CF-Connecting-IP": "192.0.2.2" },
        )
      ).status,
      429,
    );
  } finally {
    h.close();
  }
});
test("Pages gates dashboard, recovery and previews; public login contains no app data", async () => {
  const h = await setup();
  try {
    const env = { ...h.env, ADMIN_API: { fetch: (r) => api.fetch(r, h.env) } };
    const page = (path, headers) =>
      onRequest({
        env,
        request: h.request(path, "GET", undefined, headers),
        next: async () => new Response("shell"),
      });
    assert.equal((await page("/")).status, 303);
    const login = await page("/login");
    assert.equal(login.status, 200);
    assert.ok(
      login.headers
        .get("Content-Security-Policy")
        .includes("frame-ancestors 'none'"),
    );
    assert.equal((await page("/access-recovery")).status, 303);
    assert.equal(
      (await page("/access-recovery", { "Cf-Access-Jwt-Assertion": h.jwt }))
        .status,
      200,
    );
    const cookie = (await h.recover()).headers.get("Set-Cookie").split(";")[0];
    assert.equal((await page("/", { Cookie: cookie })).status, 200);
    assert.equal(
      (
        await onRequest({
          env,
          request: new Request("https://big-cloack-admin.pages.dev/login"),
          next: async () => new Response("leak"),
        })
      ).status,
      401,
    );
  } finally {
    h.close();
  }
});
