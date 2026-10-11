import test from "node:test";
import assert from "node:assert/strict";
import { validateSlug, cloakLinkUrl } from "../shared/slug.mjs";
import { validateLink } from "../workers/rules.mjs";
import redirect from "../workers/redirect.mjs";
import { harness } from "./harness.mjs";

const payload = {
  name: "Slug test",
  mode: "real",
  device: "all",
  real_urls: ["https://example.com/real"],
  waiting_url: "https://example.com/wait",
};

test("slug normalization, separators, allowed characters and existing limits", () => {
  for (const slug of [
    "oferta",
    "oferta/teste",
    "curso/turma-1",
    "netfiscal/mba/reforma",
    "a/b",
    "_a/-b/0_1",
    "a".repeat(64),
  ]) {
    assert.equal(validateSlug(` ${slug.toUpperCase()} `), slug);
    assert.equal(
      cloakLinkUrl("links.example.com", slug),
      `https://links.example.com/${slug}`,
    );
  }
  for (const slug of [
    "",
    "ab",
    "/",
    "/oferta",
    "oferta/",
    "oferta//teste",
    "a///b",
    "a b/c",
    "ação/teste",
    "a.b/c",
    "a\\b",
    "a/%2f/b",
    "a?b",
    "a#b",
    "a".repeat(65),
  ])
    assert.throws(() => validateSlug(slug), /Slug:/);
  for (const slug of ["api", "health", "__domain-check"])
    assert.throws(() => validateSlug(slug), /reservado/);
  assert.match(validateLink(payload).slug, /^[a-z0-9]{10}$/);
});

test("CRUD, full-slug uniqueness and redirects at one, two and three levels", async () => {
  const h = await harness();
  const pending = [];
  const visit = (path, method = "GET") =>
    redirect.fetch(
      new Request(`https://links.example.com/${path}`, { method }),
      h.env,
      {
        waitUntil(p) {
          pending.push(p);
        },
      },
    );
  try {
    h.db.exec(
      "INSERT INTO domains(id,hostname,verified) VALUES('test','links.example.com',1)",
    );
    const links = [];
    for (const slug of [
      "oferta",
      "oferta/teste",
      "oferta/teste/turma-1",
      "curso/turma-1",
      "netfiscal/mba/reforma",
    ]) {
      const data = {
        ...payload,
        slug: slug.toUpperCase(),
        real_urls: [`https://example.com/${slug}`],
      };
      const created = await h.call("links", "POST", data);
      assert.equal(created.status, 201);
      const link = await created.json();
      links.push(link);
      assert.equal(link.slug, slug);
      assert.equal((await h.call("links", "POST", data)).status, 409);
      for (const method of ["GET", "HEAD"]) {
        const response = await visit(slug + "?utm_source=test", method);
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("Location"), data.real_urls[0]);
      }
    }
    assert.throws(
      () =>
        h.db
          .prepare("UPDATE links SET slug=? WHERE id=?")
          .run(links[0].slug, links[1].id),
      /UNIQUE/,
    );
    assert.equal(
      (
        await h.call(`links/${links[1].id}`, "PUT", {
          ...payload,
          slug: "OFERTA",
        })
      ).status,
      409,
    );
    for (const slug of [
      "oferta//teste",
      "/oferta",
      "oferta/",
      "oferta/teste/",
      "oferta/ /teste",
    ]) {
      assert.equal(
        (await h.call("links", "POST", { ...payload, slug })).status,
        400,
      );
      assert.equal(
        (await h.call(`links/${links[0].id}`, "PUT", { ...payload, slug }))
          .status,
        400,
      );
      assert.equal((await visit(slug)).status, 404);
    }
    assert.equal((await visit("oferta/teste/missing")).status, 404);
    assert.equal((await visit("oferta/other")).status, 404);
    await Promise.all(pending);
    const updated = await h.call(`links/${links[2].id}`, "PUT", {
      ...payload,
      slug: "Nova/Turma_1/Teste",
      mode: "waiting",
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).slug, "nova/turma_1/teste");
    assert.equal((await visit(links[2].slug)).status, 404);
    assert.equal(
      (await visit("nova/turma_1/teste")).headers.get("Location"),
      payload.waiting_url,
    );
    assert.equal(
      (await visit("oferta")).headers.get("Location"),
      "https://example.com/oferta",
    );
    await Promise.all(pending);
    assert.equal((await h.call(`links/${links[2].id}`, "DELETE")).status, 200);
    assert.equal((await visit("nova/turma_1/teste")).status, 404);
  } finally {
    await Promise.all(pending);
    h.close();
  }
});
