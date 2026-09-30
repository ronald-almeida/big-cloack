import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness } from "./harness.mjs";
import { renderFarm } from "../workers/farm-render.mjs";
import { farmThemes, farmSlug } from "../shared/farm.mjs";
import farmPublic from "../workers/farm-public.mjs";
const company = {
  cnpj: "53749174000118",
  razao: "Empresa Teste LTDA",
  fantasia: "Empresa Teste",
  cidade: "Recife",
  uf: "PE",
  atividade: "Serviços",
  telefone: "55996633538",
  email: "contato@example.com",
};
const input = (extra = {}) => ({
  data: company,
  theme: "id01",
  subdomain: "empresa-teste",
  head: "",
  ...extra,
});
async function setup() {
  const h = await harness(),
    original = globalThis.fetch,
    bindings = new Map(),
    calls = [];
  h.env.CLOUDFLARE_API_TOKEN = "test";
  h.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
  const state = { pending: false, fail: false, conflict: false };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    calls.push({ url: String(url), method: options.method || "GET" });
    if (u.hostname === "api.cloudflare.com") {
      if (state.fail)
        return Response.json(
          { success: false, errors: [{ message: "Sem permissão" }] },
          { status: 403 },
        );
      let result;
      if (u.pathname.endsWith("/zones"))
        result = [
          {
            id: "b".repeat(32),
            name: u.searchParams.get("name"),
            status: state.pending ? "pending" : "active",
            account: { id: h.env.CLOUDFLARE_ACCOUNT_ID },
            name_servers: ["ns1.example.com", "ns2.example.com"],
          },
        ];
      else if (u.pathname.includes("/dns_records"))
        result = state.conflict ? [{ id: "unrelated-record" }] : [];
      else if (options.method === "PUT") {
        const b = JSON.parse(options.body);
        result = { ...b, id: crypto.randomUUID() };
        bindings.set(b.hostname, result);
      } else if (options.method === "DELETE") {
        for (const [key, b] of bindings)
          if (u.pathname.endsWith("/" + b.id)) bindings.delete(key);
        result = {};
      } else
        result = [...bindings.values()].filter(
          (b) => b.hostname === u.searchParams.get("hostname"),
        );
      return Response.json({ success: true, result });
    }
    if (u.hostname === "brasilapi.com.br")
      return Response.json({
        cnpj: company.cnpj,
        razao_social: company.razao,
        nome_fantasia: company.fantasia,
        municipio: "Recife",
        uf: "PE",
      });
    if (u.pathname === "/__farm-check")
      return farmPublic.fetch(new Request(url), h.env);
    return original(url, options);
  };
  return { ...h, bindings, calls, state };
}
async function domain(h, hostname = "farm-example.com", site_limit = 2) {
  const r = await h.call("farm/domains", "POST", { hostname, site_limit });
  assert.equal(r.status, 201, await r.clone().text());
  return r.json();
}
test("original 20 themes render safely without editor, sample identity or inherited verification", () => {
  assert.equal(farmThemes.length, 20);
  assert.equal(farmSlug("São João & Filhos"), "sao-joao-filhos");
  for (const { id } of farmThemes) {
    const html = renderFarm(
      { ...company, razao: "<img src=x onerror=alert(1)>", fantasia: "A & B" },
      id,
      '<meta name="verification" content="custom">',
    );
    assert.ok(html.includes('data-estilo="' + id + '"'));
    assert.ok(html.includes("A &amp; B"));
    assert.ok(html.includes("&lt;img"));
    assert.ok(!html.includes('<div class="vw-painel">'));
    assert.ok(!html.includes("data-modulo"));
    assert.ok(!html.includes("RAFAEL FRANCA"));
    assert.ok(!html.includes("almyg594"));
    assert.ok(!html.includes("{{"));
    assert.ok(html.includes("tel:+5555996633538"));
    assert.ok(html.indexOf('content="custom"') < html.indexOf("</head>"));
  }
});
test("farm authenticated lifecycle, BrasilAPI, capacity, HEAD snapshots, rename, deletion and isolation", async () => {
  const h = await setup();
  try {
    assert.equal(
      (
        await h.call("farm/sites", "GET", undefined, {
          "Cf-Access-Jwt-Assertion": "",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call(
          "farm/domains",
          "POST",
          {},
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    const c = await (await h.call("farm/cnpj?cnpj=" + company.cnpj)).json();
    assert.equal(c.source, "BrasilAPI");
    const d = await domain(h),
      d2 = await domain(h, "farm-two.com", null);
    let r = await h.call("farm/sites", "POST", input({ domain_id: d.id }));
    assert.equal(r.status, 201);
    const { id } = await r.json();
    r = await h.call("farm/sites/" + id + "/publish", "POST", {});
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).status, "published");
    const publicRequest = () =>
      farmPublic.fetch(
        new Request("https://empresa-teste.farm-example.com/"),
        h.env,
      );
    assert.equal((await publicRequest()).status, 200);
    await h.call("farm/sites/" + id + "/head", "PUT", {
      head: '<meta name="test-head" content="v2">',
    });
    assert.ok(!(await (await publicRequest()).text()).includes("test-head"));
    await h.call("farm/sites/" + id + "/publish", "POST", {});
    assert.ok((await (await publicRequest()).text()).includes("test-head"));
    assert.equal(h.bindings.size, 1);
    const auto = await (
      await h.call("farm/sites", "POST", input({ subdomain: "auto" }))
    ).json();
    assert.equal(
      h.db.prepare("SELECT domain_id FROM farm_sites WHERE id=?").get(auto.id)
        .domain_id,
      d2.id,
    );
    assert.equal((await h.call("farm/domains/" + d.id, "DELETE")).status, 400);
    await h.call("farm/domains/" + d.id, "PUT", { active: false });
    assert.equal((await publicRequest()).status, 404);
    assert.equal(
      (await h.call("farm/sites/" + id + "/publish", "POST", {})).status,
      400,
    );
    await h.call("farm/domains/" + d.id, "PUT", { active: true });
    r = await h.call(
      "farm/sites/" + id,
      "PUT",
      input({ domain_id: d.id, subdomain: "novo-nome" }),
    );
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(h.bindings.size, 0);
    await h.call("farm/sites/" + id + "/publish", "POST", {});
    assert.equal((await publicRequest()).status, 404);
    assert.equal(
      (
        await farmPublic.fetch(
          new Request("https://novo-nome.farm-example.com/"),
          h.env,
        )
      ).status,
      200,
    );
    assert.equal((await h.call("farm/sites/" + id, "DELETE")).status, 200);
    assert.equal(h.bindings.size, 0);
    assert.equal((await h.call("farm/domains/" + d.id, "DELETE")).status, 200);
    assert.ok(
      (await (await h.call("farm/sites/" + id + "/history")).json()).some(
        (x) => x.action === "delete",
      ),
    );
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM domains").get().n, 0);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM links").get().n, 0);
  } finally {
    h.close();
  }
});
test("database guards simultaneous capacity, inactive domains, failures and retry", async () => {
  const h = await setup();
  try {
    const d = await domain(h, "capacity.com", 1);
    const responses = await Promise.all(
      ["one", "two"].map((subdomain) =>
        h.call("farm/sites", "POST", input({ domain_id: d.id, subdomain })),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM farm_sites").get().n, 1);
    const id = h.db.prepare("SELECT id FROM farm_sites").get().id;
    h.state.conflict = true;
    assert.equal(
      (await h.call("farm/sites/" + id + "/publish", "POST", {})).status,
      400,
    );
    assert.equal(h.bindings.size, 0);
    h.state.conflict = false;
    h.state.fail = true;
    assert.equal(
      (await h.call("farm/sites/" + id + "/publish", "POST", {})).status,
      400,
    );
    assert.equal(
      h.db.prepare("SELECT status FROM farm_sites").get().status,
      "error",
    );
    h.state.fail = false;
    const results = await Promise.all([
      h.call("farm/sites/" + id + "/publish", "POST", {}),
      h.call("farm/sites/" + id + "/publish", "POST", {}),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    assert.equal(h.bindings.size, 1);
    await h.call("farm/domains/" + d.id, "PUT", { site_limit: 0 });
    assert.equal(
      (await h.call("farm/sites/" + id + "/publish", "POST", {})).status,
      200,
    );
    await h.call("farm/domains/" + d.id, "PUT", { active: false });
    assert.equal(
      (await h.call("farm/sites", "POST", input({ subdomain: "no" }))).status,
      400,
    );
    h.state.pending = true;
    const pending = await domain(h, "pending.com", null);
    assert.equal(pending.active, 0);
    assert.equal(
      (await h.call("farm/sites", "POST", input({ domain_id: pending.id })))
        .status,
      400,
    );
  } finally {
    h.close();
  }
});
