import { normalizeFarmCnpj as normalizeCnpj } from "../shared/companies.mjs";
import { verifyFarmCompany } from "./farm-cnpj.mjs";
import { quantity, searchFilters, formCompany } from "../shared/companies.mjs";
const json = (v, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
async function expire(env) {
  await env.DB.prepare(
    "UPDATE farm_company_selections SET state='unused',reservation_token=NULL,reserved_until=NULL WHERE state='reserved' AND reserved_until<=?",
  )
    .bind(Date.now())
    .run();
}
async function exclusions(env) {
  const rows = [];
  let after = "";
  // Only operational metadata crosses the API; the national registry never enters D1.
  while (true) {
    const page = (
      await env.DB.prepare(
        "SELECT cnpj FROM farm_company_selections WHERE cnpj>? AND (state IN ('reserved','used') OR (status_code IS NOT NULL AND status_code<>2)) ORDER BY cnpj LIMIT 1000",
      )
        .bind(after)
        .all()
    ).results;
    rows.push(...page.map((x) => x.cnpj));
    if (rows.length > 100000)
      throw fail(
        "Volume de seleções excede o limite configurado do motor. Amplie a integração antes de continuar.",
        503,
      );
    if (page.length < 1000) return rows;
    after = page.at(-1).cnpj;
  }
}
async function engine(env, path, payload) {
  if (!env.COMPANY_SEARCH_URL || !env.COMPANY_SEARCH_TOKEN)
    throw fail(
      "A base oficial de CNPJs ainda não está configurada. Conclua a importação e conecte o motor de busca.",
      503,
    );
  const base = new URL(env.COMPANY_SEARCH_URL);
  if (base.protocol !== "https:" || base.username || base.password)
    throw fail("Configuração do motor de busca inválida.", 503);
  let r;
  try {
    r = await fetch(new URL(path, base), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.COMPANY_SEARCH_TOKEN,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw fail("Motor de busca indisponível. Tente novamente.", 503);
  }
  if (!r.ok) {
    if (r.status === 404)
      throw fail("Empresa não encontrada na base oficial.", 404);
    if (r.status === 409)
      throw fail("A base oficial foi atualizada. Inicie uma nova busca.", 409);
    throw fail(
      "Não foi possível consultar a base oficial (HTTP " + r.status + ").",
      503,
    );
  }
  return r.json();
}
async function recordVerification(env, c) {
  await env.DB.prepare(
    `INSERT INTO farm_company_selections(cnpj,snapshot,status_code,verified_at) VALUES(?,?,?,?)
    ON CONFLICT(cnpj) DO UPDATE SET snapshot=excluded.snapshot,status_code=excluded.status_code,verified_at=excluded.verified_at,
    updated_at=excluded.verified_at`,
  )
    .bind(c.cnpj, JSON.stringify(c), c.status_code, c.verified_at)
    .run();
}
export async function companiesAPI(request, env, readBody) {
  const u = new URL(request.url),
    p = u.pathname,
    m = request.method;
  try {
    await expire(env);
    if (
      ["/api/farm/companies/search", "/api/farm/companies/count"].includes(p) &&
      m === "GET"
    ) {
      const input = Object.fromEntries(u.searchParams),
        filters = searchFilters(input);
      const payload = {
        filters,
        limit: quantity(input.quantity),
        cursor: input.cursor || null,
        exclude: await exclusions(env),
      };
      const result = await engine(
        env,
        p.endsWith("count") ? "/count" : "/search",
        payload,
      );
      return json(result);
    }
    if (p === "/api/farm/companies/selections" && m === "GET") {
      const state = u.searchParams.get("state") || "used";
      if (!["used", "reserved"].includes(state)) throw fail("Estado inválido.");
      const n = quantity(u.searchParams.get("quantity"), 25),
        after = u.searchParams.get("after") || "";
      const rows = (
        await env.DB.prepare(
          "SELECT cnpj,state,site_id,snapshot,verified_at,reserved_until FROM farm_company_selections WHERE state=? AND cnpj>? ORDER BY cnpj LIMIT ?",
        )
          .bind(state, after, n + 1)
          .all()
      ).results;
      return json({
        results: rows
          .slice(0, n)
          .map(({ snapshot, ...r }) => ({ ...JSON.parse(snapshot), ...r })),
        next_cursor: rows.length > n ? rows[n - 1].cnpj : null,
      });
    }
    const match = p.match(
      /^\/api\/farm\/companies\/company\/([^/]+)(?:\/(verify|reserve|release))?$/,
    );
    if (!match) return json({ error: "Rota de empresas não encontrada." }, 404);
    const cnpj = normalizeCnpj(decodeURIComponent(match[1])),
      action = match[2];
    if (!action && m === "GET") {
      const c = await engine(env, "/company/" + cnpj, {});
      const selection = await env.DB.prepare(
        "SELECT state,status_code,verified_at FROM farm_company_selections WHERE cnpj=?",
      )
        .bind(cnpj)
        .first();
      return json({
        ...c,
        state: selection?.state || "unused",
        last_verification: selection,
      });
    }
    if (action === "verify" && m === "POST") {
      const c = await verifyFarmCompany(cnpj);
      await recordVerification(env, c);
      return json(c);
    }
    if (action === "reserve" && m === "POST") {
      const old = await env.DB.prepare(
        "SELECT state FROM farm_company_selections WHERE cnpj=?",
      )
        .bind(cnpj)
        .first();
      if (old && old.state !== "unused")
        throw fail(
          "Este CNPJ já foi utilizado ou está reservado. Escolha outro disponível.",
          409,
        );
      const c = await verifyFarmCompany(cnpj);
      await recordVerification(env, c);
      if (c.status_code !== 2)
        return json(
          {
            error:
              "CNPJ " + c.situacao + ". Uso bloqueado; escolha outro elegível.",
            code: "COMPANY_INACTIVE",
            company: c,
          },
          409,
        );
      const token = crypto.randomUUID(),
        until = Date.now() + 30 * 60000;
      const r = await env.DB.prepare(
        "UPDATE farm_company_selections SET state='reserved',reservation_token=?,reserved_until=? WHERE cnpj=? AND state='unused' AND status_code=2 AND NOT EXISTS(SELECT 1 FROM farm_sites WHERE cnpj=?)",
      )
        .bind(token, until, cnpj, cnpj)
        .run();
      if (!r.meta.changes)
        throw fail(
          "Este CNPJ acabou de ser reservado ou utilizado. Escolha outro disponível.",
          409,
        );
      return json({
        company: c,
        data: formCompany(c),
        reservation_token: token,
        reserved_until: until,
      });
    }
    if (action === "release" && m === "POST") {
      const input = await readBody(request);
      await env.DB.prepare(
        "UPDATE farm_company_selections SET state='unused',reservation_token=NULL,reserved_until=NULL WHERE cnpj=? AND state='reserved' AND reservation_token=?",
      )
        .bind(cnpj, String(input.reservation_token || ""))
        .run();
      return json({ ok: true });
    }
    return json({ error: "Método não permitido." }, 405);
  } catch (e) {
    return json({ error: e.message }, e.status || 400);
  }
}
