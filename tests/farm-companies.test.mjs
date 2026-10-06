import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { verifyFarmCompany } from "../workers/farm-cnpj.mjs";
import { harness } from "./harness.mjs";
import {
  companyFixture,
  onlineFixture,
  fixtureCnpj,
} from "./company-fixture.mjs";
import {
  searchFilters,
  companyAge,
  isoDate,
  normalizeFarmCnpj,
} from "../shared/companies.mjs";

async function setup() {
  const h = await harness(),
    f = companyFixture(),
    original = globalThis.fetch;
  const state = { status: 2, fail: false, missing: false, calls: 0 };
  h.env.COMPANY_SEARCH_URL = "https://company-search.example";
  h.env.COMPANY_SEARCH_TOKEN = "fixture-secret";
  globalThis.fetch = async (url, options) => {
    const u = new URL(String(url));
    if (u.hostname === "company-search.example") {
      assert.equal(options.headers.Authorization, "Bearer fixture-secret");
      assert.equal(options.redirect, "manual");
      try {
        return Response.json(f.run(u.pathname, JSON.parse(options.body)));
      } catch (e) {
        return Response.json({ error: e.message }, { status: e.status || 400 });
      }
    }
    if (u.hostname === "brasilapi.com.br") {
      state.calls++;
      if (state.fail) return new Response("", { status: 429 });
      const c = f.run("/company/" + u.pathname.split("/").at(-1));
      const raw = onlineFixture({ ...c, status_code: state.status });
      if (state.missing) delete raw.situacao_cadastral;
      return Response.json(raw);
    }
    return original(url, options);
  };
  h.db.exec(
    "INSERT INTO farm_domains(id,hostname,active,zone_status) VALUES('test-domain','farm-test.example',1,'active')",
  );
  return {
    ...h,
    f,
    state,
    close() {
      f.db.close();
      h.close();
    },
  };
}
const selected = (h, c) =>
  h.call("farm/companies/company/" + c + "/reserve", "POST", {});
test("search 10 -> details -> online reserve -> filled site -> verify -> used; Cloak remains untouched", async () => {
  const h = await setup();
  try {
    const response = await h.call("farm/companies/search?quantity=10");
    assert.equal(response.status, 200, await response.clone().text());
    const found = await response.json();
    assert.equal(found.results.length, 10);
    assert.ok(found.results.every((c) => c.status_code === 2));
    assert.equal(h.state.calls, 0);
    const c = found.results[0];
    const detail = await (
      await h.call("farm/companies/company/" + c.cnpj)
    ).json();
    assert.equal(detail.details.fixture, true);
    const reservation = await (await selected(h, c.cnpj)).json();
    assert.equal(h.state.calls, 1);
    assert.equal(reservation.company.status_code, 2);
    assert.ok(reservation.company.verified_at);
    assert.equal(reservation.data.razao, c.razao);
    assert.match(reservation.data.abertura, /^\d{2}\/\d{2}\/\d{4}$/);
    assert.equal(
      h.db
        .prepare("SELECT state FROM farm_company_selections WHERE cnpj=?")
        .get(c.cnpj).state,
      "reserved",
    );
    const form = {
      data: reservation.data,
      reservation_token: reservation.reservation_token,
      theme: "id01",
      subdomain: "selected-company",
    };
    const created = await h.call("farm/sites", "POST", form);
    assert.equal(created.status, 201, await created.clone().text());
    const row = h.db
      .prepare("SELECT * FROM farm_sites WHERE cnpj=?")
      .get(c.cnpj);
    assert.equal(JSON.parse(row.data).email, c.email);
    assert.equal(
      h.db
        .prepare("SELECT state FROM farm_company_selections WHERE cnpj=?")
        .get(c.cnpj).state,
      "used",
    );
    assert.equal((await selected(h, c.cnpj)).status, 409);
    assert.equal(
      (await h.call("farm/sites", "POST", { ...form, subdomain: "replayed" }))
        .status,
      409,
    );
    const verified = await (
      await h.call("farm/companies/company/" + c.cnpj + "/verify", "POST", {})
    ).json();
    assert.equal(verified.situacao, "ATIVA");
    assert.ok(verified.verified_at);
    const used = await (await h.call("farm/companies/selections")).json();
    assert.equal(used.results[0].cnpj, c.cnpj);
    const fresh = await (
      await h.call("farm/companies/search?quantity=10")
    ).json();
    assert.equal(fresh.results.length, 10);
    assert.ok(!fresh.results.some((x) => x.cnpj === c.cnpj));
    assert.equal(
      (await (await h.call("farm/companies/count")).json()).count,
      29,
    );
    h.db.prepare("DELETE FROM farm_sites WHERE id=?").run(row.id);
    assert.equal(
      (await selected(h, c.cnpj)).status,
      409,
      "deleted sites must not make identity unused",
    );
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM links").get().n, 0);
  } finally {
    h.close();
  }
});
test("inactive/unknown/unavailable online validation fails closed and offers another eligible", async () => {
  const h = await setup();
  try {
    const c = fixtureCnpj(30);
    h.state.status = 8;
    const inactive = await selected(h, c);
    assert.equal(inactive.status, 409);
    assert.equal((await inactive.json()).code, "COMPANY_INACTIVE");
    const results = await (
      await h.call("farm/companies/search?quantity=10")
    ).json();
    assert.equal(results.results.length, 10);
    assert.ok(!results.results.some((x) => x.cnpj === c));
    h.state.status = 2;
    h.state.missing = true;
    assert.equal((await selected(h, fixtureCnpj(29))).status, 400);
    h.state.missing = false;
    h.state.fail = true;
    assert.equal((await selected(h, fixtureCnpj(29))).status, 400);
    assert.equal(
      h.db
        .prepare(
          "SELECT COUNT(*) AS n FROM farm_company_selections WHERE state='reserved'",
        )
        .get().n,
      0,
    );
  } finally {
    h.close();
  }
});
test("concurrent reservation, wrong token, expiry and changed status are enforced atomically", async () => {
  const h = await setup();
  try {
    const c = fixtureCnpj(1),
      responses = await Promise.all([selected(h, c), selected(h, c)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const r = await responses.find((x) => x.status === 200).json();
    await h.call("farm/companies/company/" + c + "/release", "POST", {
      reservation_token: "wrong",
    });
    assert.equal(
      h.db
        .prepare("SELECT state FROM farm_company_selections WHERE cnpj=?")
        .get(c).state,
      "reserved",
    );
    h.db
      .prepare(
        "UPDATE farm_company_selections SET reserved_until=0 WHERE cnpj=?",
      )
      .run(c);
    assert.equal(
      (
        await h.call("farm/sites", "POST", {
          data: r.data,
          theme: "id01",
          subdomain: "expired",
          reservation_token: r.reservation_token,
        })
      ).status,
      409,
    );
    const next = await (await selected(h, c)).json();
    assert.ok(next.reservation_token);
    assert.notEqual(next.reservation_token, r.reservation_token);
    h.state.status = 4;
    await h.call("farm/companies/company/" + c + "/verify", "POST", {});
    assert.equal(
      (
        await h.call("farm/sites", "POST", {
          data: next.data,
          theme: "id01",
          subdomain: "inactive",
          reservation_token: next.reservation_token,
        })
      ).status,
      409,
    );
    await h.call("farm/companies/company/" + c + "/release", "POST", {
      reservation_token: next.reservation_token,
    });
    assert.equal(
      h.db
        .prepare("SELECT state FROM farm_company_selections WHERE cnpj=?")
        .get(c).state,
      "unused",
    );
  } finally {
    h.close();
  }
});
test("keyset pagination, all filters, exact count, exhausted quantity and stale cursor", async () => {
  const h = await setup();
  try {
    const a = await (await h.call("farm/companies/search?quantity=10")).json();
    const b = await (
      await h.call(
        "farm/companies/search?quantity=10&cursor=" +
          encodeURIComponent(a.next_cursor),
      )
    ).json();
    assert.equal(
      new Set([...a.results, ...b.results].map((x) => x.cnpj)).size,
      20,
    );
    const filter =
      "uf=BA&municipio=SALVADOR&cnae=6201501&matriz_filial=1&has_phone=true&has_email=true&quantity=100";
    const filtered = await (
      await h.call("farm/companies/search?" + filter)
    ).json();
    assert.ok(filtered.results.length > 0);
    assert.ok(
      filtered.results.every((x) => x.uf === "BA" && x.telefone && x.email),
    );
    assert.equal(filtered.exhausted, true);
    assert.equal(
      (await (await h.call("farm/companies/count?" + filter)).json()).count,
      filtered.results.length,
    );
    assert.equal(
      (
        await h.call(
          "farm/companies/search?uf=SP&cursor=" +
            encodeURIComponent(a.next_cursor),
        )
      ).status,
      409,
    );
    for (const q of [
      "quantity=101",
      "quantity=0",
      "quantity=NaN",
      "opened_from=2026-02-30",
      "uf=XX",
      "cnae=abc",
    ])
      assert.equal((await h.call("farm/companies/search?" + q)).status, 400);
    assert.equal(
      (
        await h.call("farm/companies/search", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": "",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call(
          "farm/companies/company/" + fixtureCnpj(1) + "/reserve",
          "POST",
          {},
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    delete h.env.COMPANY_SEARCH_URL;
    assert.equal((await h.call("farm/companies/search")).status, 503);
  } finally {
    h.close();
  }
});
test("age boundaries and strict dates", () => {
  assert.equal(normalizeFarmCnpj("12.ABC.345/01DE-35"), "12ABC34501DE35");
  assert.throws(() => normalizeFarmCnpj("12ABC34501DE36"));
  assert.equal(isoDate("31/02/2026"), "");
  assert.equal(
    searchFilters({ age: "1" }, new Date("2024-03-31T00:00:00Z")).opened_from,
    "2024-02-29",
  );
  assert.equal(
    companyAge("2025-10-06", new Date("2026-10-05T00:00:00Z")),
    "11 meses",
  );
});

test("populated Farm migration backfills usage without changing sites", () => {
  const db = new DatabaseSync(":memory:"),
    root = new URL("../migrations/", import.meta.url);
  try {
    for (const file of readdirSync(root)
      .filter((f) => f.endsWith(".sql") && !f.startsWith("0008"))
      .sort())
      db.exec(readFileSync(new URL(file, root), "utf8"));
    db.exec(
      "INSERT INTO farm_domains(id,hostname,active,zone_status) VALUES('d','example.test',1,'active')",
    );
    db.prepare(
      "INSERT INTO farm_sites(id,domain_id,subdomain,company,cnpj,data,theme) VALUES('s','d','before','Existing',?,'{}','id01')",
    ).run(fixtureCnpj(1));
    db.exec(readFileSync(new URL("0008_farm_companies.sql", root), "utf8"));
    assert.equal(
      db.prepare("SELECT state FROM farm_company_selections").get().state,
      "used",
    );
    assert.equal(
      db.prepare("SELECT company FROM farm_sites").get().company,
      "Existing",
    );
  } finally {
    db.close();
  }
});

test("online validation preserves alphanumeric CNPJ and rejects identity mismatch", async () => {
  const raw = {
    cnpj: "12ABC34501DE35",
    razao_social: "EXEMPLO",
    situacao_cadastral: 2,
    data_inicio_atividade: "2026-01-01",
  };
  const verified = await verifyFarmCompany(raw.cnpj, async () =>
    Response.json(raw),
  );
  assert.equal(verified.cnpj, raw.cnpj);
  assert.equal(verified.situacao, "ATIVA");
  await assert.rejects(
    () =>
      verifyFarmCompany(raw.cnpj, async () =>
        Response.json({ ...raw, cnpj: fixtureCnpj(1) }),
      ),
    /divergente/,
  );
});
