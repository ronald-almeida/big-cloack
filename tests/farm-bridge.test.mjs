import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.mjs";
import api from "../workers/api.mjs";
import { bridgeState } from "../workers/farm-bridge.mjs";

const admin = { id: "ADMIN", role: "admin", name: "Admin" },
  alice = { id: "EMP-alice", role: "employee", name: "Alice" },
  bob = { id: "EMP-bob", role: "employee", name: "Bob" };
const draft = {
  data: {
    cnpj: "53749174000118",
    razao: "Empresa Teste",
    fantasia: "Teste",
    cidade: "Recife",
    uf: "PE",
  },
  theme: "id01",
  subdomain: "empresa",
  publish_mode: "subdomain",
  head: '<meta name="verification" content="preserve">',
};
async function fixture() {
  const h = await harness();
  Object.assign(h.env, {
    FARM_BRIDGE_SECRET: "w".repeat(64),
    FARM_BRIDGE_READ_SECRET: "r".repeat(64),
    FARM_BRIDGE_MODE: "write",
    FARM_OPERACAO_ORIGIN: "https://operacao.example",
    CLOUDFLARE_API_TOKEN: "test",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  });
  const domain = crypto.randomUUID();
  h.db
    .prepare(
      "INSERT INTO farm_domains(id,hostname,active,zone_status,zone_id) VALUES(?,'farm.example',1,'active',?)",
    )
    .run(domain, "b".repeat(32));
  const call = async (input, actor = admin, key = h.env.FARM_BRIDGE_SECRET) => {
    const response = await api.fetch(
      new Request(h.env.ADMIN_ORIGIN + "/api/operacao-farm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify({ actor, ...input }),
      }),
      h.env,
    );
    return { status: response.status, body: await response.json() };
  };
  const run = (cmd, id, data = {}, actor = admin, extra = {}) =>
    call(
      {
        action: "command",
        cmd,
        id,
        data,
        requestId: crypto.randomUUID(),
        ...extra,
      },
      actor,
    );
  return { ...h, domain, run, bridge: call };
}
test("Farm bridge authenticates, read credential cannot mutate, legacy routes disable without affecting other API authentication", async () => {
  const h = await fixture();
  try {
    assert.equal(
      (await h.bridge({ action: "state" }, admin, "bad")).status,
      401,
    );
    const view = await h.bridge(
      { action: "state" },
      admin,
      h.env.FARM_BRIDGE_READ_SECRET,
    );
    assert.equal(view.status, 200);
    assert.equal(view.body.farm.writable, false);
    assert.equal(
      (
        await h.bridge(
          {
            action: "command",
            cmd: "farm-site",
            data: draft,
            requestId: crypto.randomUUID(),
          },
          admin,
          h.env.FARM_BRIDGE_READ_SECRET,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.bridge({
          action: "command",
          cmd: "delete-redirector",
          requestId: crypto.randomUUID(),
        })
      ).status,
      404,
    );
    assert.equal(
      (await h.run("farm-domain", null, { hostname: "operacao.example" }))
        .status,
      400,
    );
    h.env.FARM_LEGACY_MODE = "disabled";
    assert.equal((await h.call("farm/sites")).status, 410);
    assert.equal((await h.call("links")).status, 200);
    const anonymous = await api.fetch(
      new Request(h.env.ADMIN_ORIGIN + "/api/links"),
      h.env,
    );
    assert.equal(anonymous.status, 401);
  } finally {
    h.close();
  }
});
test("Farm bridge ownership, deterministic receipts, history and snapshots preserve existing data", async () => {
  const h = await fixture();
  try {
    const requestId = crypto.randomUUID(),
      created = await h.run(
        "farm-site",
        null,
        { ...draft, domain_id: h.domain, owner: bob.id },
        alice,
        { requestId },
      );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.id, requestId);
    const replay = await h.run(
      "farm-site",
      null,
      { ...draft, domain_id: h.domain, owner: bob.id },
      alice,
      { requestId },
    );
    assert.deepEqual(replay, created);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM farm_sites").get().n, 1);
    assert.equal(
      (
        await h.run(
          "farm-site",
          null,
          { ...draft, subdomain: "other", domain_id: h.domain },
          alice,
          { requestId },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.run(
          "farm-site",
          requestId,
          { ...draft, domain_id: h.domain },
          bob,
        )
      ).status,
      403,
    );
    assert.equal(
      (await h.run("farm-domain-toggle", h.domain, { active: false }, alice))
        .status,
      403,
    );
    h.db
      .prepare(
        "UPDATE farm_sites SET published_data=data,published_head=head,published_theme=theme,published_version=version,status='published' WHERE id=?",
      )
      .run(requestId);
    const snapshot = h.db
      .prepare("SELECT published_data,published_head FROM farm_sites")
      .get();
    assert.equal(
      (
        await h.run(
          "farm-site",
          requestId,
          { ...draft, domain_id: h.domain, head: "new head" },
          alice,
        )
      ).status,
      200,
    );
    assert.deepEqual(
      h.db
        .prepare("SELECT published_data,published_head FROM farm_sites")
        .get(),
      snapshot,
    );
    assert.equal(
      (await h.run("farm-delete", requestId, {}, alice)).status,
      400,
    );
    const av = await bridgeState(h.env, alice),
      bv = await bridgeState(h.env, bob);
    assert.equal(av.farm.sites[0].owner, alice.id);
    assert.equal(bv.farm.sites.length, 0);
    assert.equal(bv.farm.history.length, 0);
    assert.equal(
      av.events.filter((e) => e.type === "Farm · Site criado").length,
      1,
    );
    assert.equal(av.farm.sites[0].snapshot.head, draft.head);
    const before = h.db.prepare("SELECT COUNT(*) n FROM links").get().n;
    assert.equal(before, 0);
  } finally {
    h.close();
  }
});
test("publication, root replacement guard and unpublish use the existing Farm binding service", async () => {
  const h = await fixture(),
    bindings = new Map();
  try {
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(url);
      if (u.hostname === "api.cloudflare.com") {
        let result = [];
        if (u.pathname.includes("/dns_records")) result = [];
        else if (options.method === "PUT") {
          const b = JSON.parse(options.body);
          result = { ...b, id: crypto.randomUUID() };
          assert.equal(b.service, "big-cloack-api");
          bindings.set(b.hostname, result);
        } else if (options.method === "DELETE") {
          for (const [host, b] of bindings)
            if (u.pathname.endsWith(b.id)) bindings.delete(host);
          return new Response(null, {status:200});
        } else
          result = [...bindings.values()].filter(
            (b) => b.hostname === u.searchParams.get("hostname"),
          );
        return Response.json({ success: true, result });
      }
      if (u.pathname === "/__farm-check") {
        const s = h.db
          .prepare(
            "SELECT * FROM farm_sites WHERE published_data IS NOT NULL LIMIT 1",
          )
          .get();
        return Response.json({
          service: "big-cloack-farm",
          site_id: s.id,
          version: s.published_version,
        });
      }
      throw Error("Unexpected test URL");
    };
    const s = await h.run("farm-site", null, {
        ...draft,
        domain_id: h.domain,
        owner: alice.id,
      }),
      id = s.body.id;
    const p = await h.run("farm-publish", id, {}, alice);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.status, "published");
    assert.equal((await h.run("farm-unpublish", id, {}, bob)).status, 403);
    assert.equal((await h.run("farm-unpublish", id, {}, alice)).status, 200);
    assert.equal(bindings.size, 0);
    assert.equal(
      h.db.prepare("SELECT published_data FROM farm_sites WHERE id=?").get(id)
        .published_data,
      null,
    );
    assert.equal((await h.run("farm-delete", id, {}, alice)).status, 200);
    const rootA=await h.run('farm-site',null,{...draft,domain_id:h.domain,publish_mode:'root',owner:alice.id});
    assert.equal((await h.run('farm-publish',rootA.body.id,{},alice)).status,200);
    const rootB=await h.run('farm-site',null,{...draft,domain_id:h.domain,publish_mode:'root',owner:bob.id});
    assert.equal((await h.run('farm-publish',rootB.body.id,{},bob,{replace:{id:rootA.body.id,version:1}})).status,403);
    assert.equal((await h.run('farm-publish',rootB.body.id)).status,409);
    assert.equal((await h.run('farm-publish',rootB.body.id,{},admin,{replace:{id:rootA.body.id,version:99}})).status,409);
    assert.equal((await h.run('farm-publish',rootB.body.id,{},admin,{replace:{id:rootA.body.id,version:1}})).status,200);
    assert.equal(h.db.prepare('SELECT published_data FROM farm_sites WHERE id=?').get(rootA.body.id).published_data,null);
    assert(h.db.prepare('SELECT published_data FROM farm_sites WHERE id=?').get(rootB.body.id).published_data);
  } finally {
    h.close();
  }
});
