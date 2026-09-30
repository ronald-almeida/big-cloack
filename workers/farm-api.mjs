import { farmThemes, farmSlug } from "../shared/farm.mjs";
import { normalizeCnpj } from "./cnpj.mjs";
import {
  farmZone,
  bindFarm,
  unbindFarm,
  verifyFarm,
} from "./farm-cloudflare.mjs";
import { renderFarm } from "./farm-render.mjs";
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const nowSQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const text = (v, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
function limit(v) {
  if (v == null || v === "") return null;
  if (!Number.isSafeInteger(Number(v)) || Number(v) < 0)
    throw Error("Limite deve ser um inteiro maior ou igual a zero.");
  return Number(v);
}
function hostname(v) {
  const h = text(v, 253).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h))
    throw Error("Informe somente o domínio, sem https ou caminho.");
  return h;
}
function data(input) {
  const d = input.data || {};
  const result = {
    cnpj: normalizeCnpj(d.cnpj),
    razao: text(d.razao),
    fantasia: text(d.fantasia),
    abertura: text(d.abertura, 30),
    atividade: text(d.atividade, 500),
    cidade: text(d.cidade, 100),
    uf: text(d.uf, 2).toUpperCase(),
    telefone: text(d.telefone, 25).replace(/\D/g, ""),
    email: text(d.email, 160),
  };
  if (!result.razao) throw Error("Informe a razão social.");
  if (!farmThemes.some((t) => t.id === input.theme))
    throw Error("Escolha um dos 20 estilos.");
  const subdomain = text(
    input.subdomain || farmSlug(result.fantasia || result.razao),
    63,
  ).toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) ||
    ["www", "api", "admin", "mail", "ftp"].includes(subdomain)
  )
    throw Error("Subdomínio inválido ou reservado.");
  if (typeof input.head !== "undefined" && typeof input.head !== "string")
    throw Error("HEAD inválido.");
  if ((input.head || "").length > 32000)
    throw Error("O HEAD deve ter até 32.000 caracteres.");
  return {
    data: result,
    subdomain,
    theme: input.theme,
    head: input.head || "",
    company: result.fantasia || result.razao,
  };
}
async function getSite(env, id) {
  const s = await env.DB.prepare("SELECT * FROM farm_sites WHERE id=?")
    .bind(id)
    .first();
  if (!s) throw Error("Site não encontrado.");
  return s;
}
async function getDomain(env, id) {
  const d = await env.DB.prepare("SELECT * FROM farm_domains WHERE id=?")
    .bind(id)
    .first();
  if (!d) throw Error("Domínio Farm não encontrado.");
  return d;
}
async function lock(env, id, fn) {
  const op = crypto.randomUUID(),
    now = Date.now();
  const r = await env.DB.prepare(
    "UPDATE farm_sites SET operation_id=?,operation_until=? WHERE id=? AND operation_until<?",
  )
    .bind(op, now + 180000, id, now)
    .run();
  if (!r.meta.changes)
    throw Error("Site em processamento. Aguarde e tente novamente.");
  try {
    return await fn(await getSite(env, id));
  } finally {
    await env.DB.prepare(
      "UPDATE farm_sites SET operation_id=NULL,operation_until=0 WHERE id=? AND operation_id=?",
    )
      .bind(id, op)
      .run();
  }
}
async function history(env, s, d, action, status, message = "") {
  await env.DB.prepare(
    "INSERT INTO farm_deployments(id,site_id,company,hostname,action,status,version,message) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      s.id,
      s.company,
      s.subdomain + "." + d.hostname,
      action,
      status,
      s.version,
      message,
    )
    .run();
}
async function cleanupAddress(env, s) {
  if (!s.pending_address) return;
  const old = JSON.parse(s.pending_address);
  await unbindFarm(env, old, { hostname: old.hostname });
  await env.DB.prepare("UPDATE farm_sites SET pending_address=NULL WHERE id=?")
    .bind(s.id)
    .run();
}
async function publish(env, s) {
  const d = await getDomain(env, s.domain_id);
  if (!d.active || d.zone_status !== "active")
    throw Error("Ative o domínio Farm antes de publicar.");
  try {
    await cleanupAddress(env, s);
    renderFarm(JSON.parse(s.data), s.theme, s.head);
    await env.DB.prepare(
      "UPDATE farm_sites SET status='provisioning' WHERE id=?",
    )
      .bind(s.id)
      .run();
    const binding = await bindFarm(env, s, d);
    await env.DB.prepare(
      `UPDATE farm_sites SET cloudflare_domain_id=?,published_data=data,published_theme=theme,published_head=head,published_version=version,status='provisioning',last_error='',published_at=${nowSQL} WHERE id=?`,
    )
      .bind(binding.id, s.id)
      .run();
    const fresh = await getSite(env, s.id),
      verified = await verifyFarm(fresh, d);
    const status = verified ? "published" : "provisioning";
    await env.DB.prepare("UPDATE farm_sites SET status=? WHERE id=?")
      .bind(status, s.id)
      .run();
    await history(
      env,
      s,
      d,
      "publish",
      status,
      verified ? "Publicado com HTTPS." : "Aguardando DNS e certificado HTTPS.",
    );
    return {
      id: s.id,
      status,
      url: "https://" + s.subdomain + "." + d.hostname,
    };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE farm_sites SET status='error',last_error=? WHERE id=?",
    )
      .bind(error.message, s.id)
      .run();
    await history(env, s, d, "publish", "error", error.message);
    throw error;
  }
}
async function cnpj(value) {
  const cnpj = normalizeCnpj(value);
  try {
    const r = await fetch("https://brasilapi.com.br/api/cnpj/v1/" + cnpj, {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw Error();
    const d = await r.json();
    if (!d.razao_social || String(d.cnpj).replace(/\D/g, "") !== cnpj)
      throw Error();
    return {
      source: "BrasilAPI",
      data: {
        cnpj,
        razao: text(d.razao_social),
        fantasia: text(d.nome_fantasia),
        abertura: text(d.data_inicio_atividade, 30).replace(
          /^(\d{4})-(\d{2})-(\d{2})$/,
          "$3/$2/$1",
        ),
        atividade: text(
          [d.cnae_fiscal, d.cnae_fiscal_descricao].filter(Boolean).join(" - "),
          500,
        ),
        cidade: text(d.municipio, 100),
        uf: text(d.uf, 2),
        telefone: text(d.ddd_telefone_1, 25),
        email: text(d.email, 160),
      },
    };
  } catch {
    throw Error(
      "Não foi possível consultar a BrasilAPI agora. Preencha ou revise os dados manualmente.",
    );
  }
}
export async function farmAPI(request, env, readBody) {
  const u = new URL(request.url),
    p = u.pathname,
    m = request.method;
  try {
    if (p === "/api/farm/themes" && m === "GET") return json(farmThemes);
    if (p === "/api/farm/cnpj" && m === "GET")
      return json(await cnpj(u.searchParams.get("cnpj")));
    if (p === "/api/farm/preview" && m === "POST") {
      const v = data(await readBody(request));
      return json({ html: renderFarm(v.data, v.theme, "") });
    }
    if (p === "/api/farm/domains" && m === "GET")
      return json(
        (
          await env.DB.prepare(
            "SELECT d.*,COUNT(s.id) AS site_count FROM farm_domains d LEFT JOIN farm_sites s ON s.domain_id=d.id GROUP BY d.id ORDER BY d.created_at DESC",
          ).all()
        ).results.map((d) => ({
          ...d,
          nameservers: JSON.parse(d.nameservers),
        })),
      );
    if (p === "/api/farm/domains" && m === "POST") {
      const input = await readBody(request),
        h = hostname(input.hostname),
        max = limit(input.site_limit);
      const conflict = await env.DB.prepare(
        "SELECT id FROM domains WHERE hostname=? OR hostname LIKE ? OR ? LIKE '%.'||hostname",
      )
        .bind(h, "%." + h, h)
        .first();
      if (conflict || h === new URL(env.ADMIN_ORIGIN).hostname)
        throw Error(
          "Use um domínio separado dos domínios do Cloak e do painel.",
        );
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO farm_domains(id,hostname,site_limit) VALUES(?,?,?)",
      )
        .bind(id, h, max)
        .run();
      try {
        const z = await farmZone(env, h, true);
        await env.DB.prepare(
          "UPDATE farm_domains SET zone_id=?,zone_status=?,nameservers=?,active=? WHERE id=?",
        )
          .bind(
            z.id,
            z.status,
            JSON.stringify(z.name_servers || []),
            z.status === "active" ? 1 : 0,
            id,
          )
          .run();
      } catch (e) {
        await env.DB.prepare("UPDATE farm_domains SET last_error=? WHERE id=?")
          .bind(e.message, id)
          .run();
      }
      return json(await getDomain(env, id), 201);
    }
    const dm = p.match(/^\/api\/farm\/domains\/([a-f0-9-]+)$/);
    if (dm && m === "PUT") {
      const d = await getDomain(env, dm[1]),
        input = await readBody(request);
      const max =
        input.site_limit === undefined ? d.site_limit : limit(input.site_limit);
      const active =
        input.active === undefined
          ? d.active
          : input.active === true || input.active === 1
            ? 1
            : 0;
      if (active || input.verify) {
        const z = await farmZone(env, d.hostname, true);
        await env.DB.prepare(
          `UPDATE farm_domains SET zone_id=?,zone_status=?,nameservers=?,active=?,site_limit=?,last_error='',updated_at=${nowSQL} WHERE id=?`,
        )
          .bind(
            z.id,
            z.status,
            JSON.stringify(z.name_servers || []),
            active && z.status === "active" ? 1 : 0,
            max,
            d.id,
          )
          .run();
      } else
        await env.DB.prepare(
          `UPDATE farm_domains SET active=0,site_limit=?,updated_at=${nowSQL} WHERE id=?`,
        )
          .bind(max, d.id)
          .run();
      return json(await getDomain(env, d.id));
    }
    if (dm && m === "DELETE") {
      const d = await getDomain(env, dm[1]);
      if (
        await env.DB.prepare(
          "SELECT id FROM farm_sites WHERE domain_id=? LIMIT 1",
        )
          .bind(d.id)
          .first()
      )
        throw Error("Exclua ou mova os sites antes de remover este domínio.");
      // Read the zone through Cloudflare; never delete a shared account zone or its DNS.
      if (d.zone_id) await farmZone(env, d.hostname);
      await env.DB.prepare("DELETE FROM farm_domains WHERE id=?")
        .bind(d.id)
        .run();
      return json({ ok: true });
    }
    if (p === "/api/farm/sites" && m === "GET") {
      const rows = (
        await env.DB.prepare(
          "SELECT s.*,d.hostname FROM farm_sites s JOIN farm_domains d ON s.domain_id=d.id ORDER BY s.created_at DESC",
        ).all()
      ).results;
      return json(
        rows.map(
          ({
            published_data,
            published_head,
            published_theme,
            operation_id,
            ...s
          }) => ({
            ...s,
            data: JSON.parse(s.data),
            url: "https://" + s.subdomain + "." + s.hostname,
          }),
        ),
      );
    }
    if (p === "/api/farm/sites" && m === "POST") {
      const input = await readBody(request),
        v = data(input),
        id = crypto.randomUUID();
      if (input.domain_id)
        await env.DB.prepare(
          "INSERT INTO farm_sites(id,domain_id,subdomain,company,cnpj,data,theme,head) VALUES(?,?,?,?,?,?,?,?)",
        )
          .bind(
            id,
            input.domain_id,
            v.subdomain,
            v.company,
            v.data.cnpj,
            JSON.stringify(v.data),
            v.theme,
            v.head,
          )
          .run();
      else {
        const r = await env.DB.prepare(
          "INSERT INTO farm_sites(id,domain_id,subdomain,company,cnpj,data,theme,head) SELECT ?,d.id,?,?,?,?,?,? FROM farm_domains d WHERE d.active=1 AND d.zone_status='active' AND (d.site_limit IS NULL OR (SELECT COUNT(*) FROM farm_sites s WHERE s.domain_id=d.id)<d.site_limit) AND NOT EXISTS(SELECT 1 FROM farm_sites s WHERE s.domain_id=d.id AND s.subdomain=?) ORDER BY (SELECT COUNT(*) FROM farm_sites s WHERE s.domain_id=d.id),d.created_at,d.id LIMIT 1",
        )
          .bind(
            id,
            v.subdomain,
            v.company,
            v.data.cnpj,
            JSON.stringify(v.data),
            v.theme,
            v.head,
            v.subdomain,
          )
          .run();
        if (!r.meta.changes)
          throw Error(
            "Não há domínio ativo com capacidade e subdomínio disponível.",
          );
      }
      return json({ id }, 201);
    }
    const sm = p.match(
      /^\/api\/farm\/sites\/([a-f0-9-]+)(?:\/(publish|head|verify|history))?$/,
    );
    if (sm) {
      const [, id, action] = sm;
      if (action === "history" && m === "GET")
        return json(
          (
            await env.DB.prepare(
              "SELECT * FROM farm_deployments WHERE site_id=? ORDER BY created_at DESC LIMIT 100",
            )
              .bind(id)
              .all()
          ).results,
        );
      if (action === "publish" && m === "POST")
        return json(await lock(env, id, (s) => publish(env, s)));
      if (action === "verify" && m === "POST")
        return json(
          await lock(env, id, async (s) => {
            const d = await getDomain(env, s.domain_id),
              ok = await verifyFarm(s, d);
            const status = ok
              ? "published"
              : s.published_data
                ? "provisioning"
                : s.status;
            await env.DB.prepare("UPDATE farm_sites SET status=? WHERE id=?")
              .bind(status, id)
              .run();
            return { status };
          }),
        );
      if (action === "head" && m === "PUT") {
        const input = await readBody(request);
        if (typeof input.head !== "string" || input.head.length > 32000)
          throw Error("HEAD inválido (máximo 32.000 caracteres).");
        return json(
          await lock(env, id, async () => {
            await env.DB.prepare(
              `UPDATE farm_sites SET head=?,version=version+1,updated_at=${nowSQL} WHERE id=?`,
            )
              .bind(input.head, id)
              .run();
            return { ok: true };
          }),
        );
      }
      if (!action && m === "PUT") {
        const input = await readBody(request),
          v = data(input);
        return json(
          await lock(env, id, async (s) => {
            await cleanupAddress(env, s);
            const d = await getDomain(env, s.domain_id),
              target = input.domain_id
                ? await getDomain(env, input.domain_id)
                : d;
            const moving = target.id !== d.id || s.subdomain !== v.subdomain;
            if (moving) {
              const count = await env.DB.prepare(
                "SELECT COUNT(*) AS n FROM farm_sites WHERE domain_id=?",
              )
                .bind(target.id)
                .first();
              if (
                !target.active ||
                target.zone_status !== "active" ||
                (target.id !== d.id &&
                  target.site_limit !== null &&
                  count.n >= target.site_limit)
              )
                throw Error("Domínio inativo ou sem capacidade.");
              const duplicate = await env.DB.prepare(
                "SELECT id FROM farm_sites WHERE domain_id=? AND subdomain=? AND id<>?",
              )
                .bind(target.id, v.subdomain, id)
                .first();
              if (duplicate) throw Error("Este subdomínio já está em uso.");
            }
            const pending =
              moving && (s.cloudflare_domain_id || s.status !== "draft")
                ? JSON.stringify({
                    hostname: d.hostname,
                    subdomain: s.subdomain,
                    cloudflare_domain_id: s.cloudflare_domain_id,
                  })
                : null;
            await env.DB.prepare(
              `UPDATE farm_sites SET domain_id=?,subdomain=?,company=?,cnpj=?,data=?,theme=?,head=?,version=version+1,updated_at=${nowSQL},pending_address=?,cloudflare_domain_id=CASE WHEN ? THEN '' ELSE cloudflare_domain_id END,published_data=CASE WHEN ? THEN NULL ELSE published_data END,status=CASE WHEN ? THEN 'draft' ELSE status END WHERE id=?`,
            )
              .bind(
                target.id,
                v.subdomain,
                v.company,
                v.data.cnpj,
                JSON.stringify(v.data),
                v.theme,
                v.head,
                pending,
                moving ? 1 : 0,
                moving ? 1 : 0,
                moving ? 1 : 0,
                id,
              )
              .run();
            if (pending) await cleanupAddress(env, await getSite(env, id));
            return { ok: true };
          }),
        );
      }
      if (!action && m === "DELETE")
        return json(
          await lock(env, id, async (s) => {
            await cleanupAddress(env, s);
            const d = await getDomain(env, s.domain_id);
            // Also reconcile a binding created before an interrupted publication.
            if (s.status !== "draft" || s.cloudflare_domain_id)
              await unbindFarm(env, s, d);
            await history(env, s, d, "delete", "success");
            await env.DB.prepare("DELETE FROM farm_sites WHERE id=?")
              .bind(id)
              .run();
            return { ok: true };
          }),
        );
    }
    return json({ error: "Rota Farm não encontrada." }, 404);
  } catch (e) {
    let message = e.message,
      status = 400;
    if (message.includes("FARM_CAPACITY")) {
      message = "Domínio atingiu o limite de sites.";
      status = 409;
    } else if (message.includes("FARM_DOMAIN_INACTIVE"))
      message = "Domínio inativo ou aguardando ativação na Cloudflare.";
    else if (message.includes("UNIQUE constraint")) {
      message = "Domínio ou subdomínio já cadastrado.";
      status = 409;
    } else if (/D1_|SQLITE|FOREIGN KEY/.test(message))
      message = "Não foi possível salvar. Atualize e tente novamente.";
    return json({ error: message }, status);
  }
}
