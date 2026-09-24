import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import api from "../workers/api.mjs";
export async function harness() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  const DB = {
    prepare(sql) {
      return {
        bind(...params) {
          return statement(sql, params);
        },
        ...statement(sql, []),
      };
    },
    async batch(queries) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const q of queries) results.push(await q.all());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  function statement(sql, params) {
    return {
      async first() {
        return db.prepare(sql).get(...params) || null;
      },
      async all() {
        return { results: db.prepare(sql).all(...params), success: true };
      },
      async run() {
        const result = db.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  const cache = new Map(),
    CACHE = {
      async get(k, type) {
        const value = cache.get(k);
        return value ? (type === "json" ? JSON.parse(value) : value) : null;
      },
      async put(k, v) {
        cache.set(k, v);
      },
    };
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  const issuer = "https://local-test.cloudflareaccess.com";
  const env = {
    DB,
    CACHE,
    ADMIN_EMAIL: "ronald.almeida307@gmail.com",
    ADMIN_ORIGIN: "https://aprovabmyksh.com",
    ACCESS_TEAM_DOMAIN: "local-test.cloudflareaccess.com",
    ACCESS_AUD: "test-audience",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) =>
    String(url) === issuer + "/cdn-cgi/access/certs"
      ? Response.json({ keys: [jwk] })
      : originalFetch(url, options);
  async function token(claims = {}) {
    return new SignJWT({ email: env.ADMIN_EMAIL, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(claims.iss || issuer)
      .setAudience(claims.aud || env.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime(claims.exp || "1h")
      .sign(privateKey);
  }
  const jwt = await token();
  async function call(path, method = "GET", data, headers = {}) {
    return api.fetch(
      new Request(env.ADMIN_ORIGIN + "/api/" + path, {
        method,
        headers: {
          "Cf-Access-Jwt-Assertion": jwt,
          Origin: env.ADMIN_ORIGIN,
          "Content-Type": "application/json",
          ...headers,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      env,
    );
  }
  return {
    env,
    db,
    cache,
    call,
    token,
    jwt,
    close() {
      db.close();
      globalThis.fetch = originalFetch;
    },
  };
}
