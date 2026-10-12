import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { credentialSql } from "../scripts/admin-credential.mjs";
import api from "../workers/api.mjs";
export async function harness() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
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
  const env = {
    DB,
    CACHE,
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_ORIGIN: "https://aprovabmyksh.com",
    AUTH_PASSWORD_PEPPER: "test-only-pepper".repeat(4),
    AUTH_SESSION_SECRET: "a".repeat(64),
  };
  const password = "Uma frase de teste 2026!";
  async function provision(nextPassword = password) {
    db.exec(
      await credentialSql(
        env.ADMIN_EMAIL,
        nextPassword,
        env.AUTH_PASSWORD_PEPPER,
      ),
    );
  }
  await provision();
  const login = await api.fetch(
    new Request(env.ADMIN_ORIGIN + "/api/auth/login", {
      method: "POST",
      headers: { Origin: env.ADMIN_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password }),
    }),
    env,
  );
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  db.exec("DELETE FROM admin_login_limits");
  const originalFetch = globalThis.fetch;
  async function call(path, method = "GET", data, headers = {}) {
    return api.fetch(
      new Request(env.ADMIN_ORIGIN + "/api/" + path, {
        method,
        headers: {
          Cookie: cookie,
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
    cookie,
    password,
    provision,
    close() {
      db.close();
      globalThis.fetch = originalFetch;
    },
  };
}
