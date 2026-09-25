import {
  cloudflareConfigured,
  connectDomain,
  verifyDomain,
} from "./domain-connect.mjs";
import { period } from "./period.mjs";
import { authenticate } from "./auth.mjs";
import { validateLink } from "./rules.mjs";
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function body(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Envie dados JSON.");
  if (!request.body) throw new Error("Dados ausentes.");
  const reader = request.body.getReader(),
    chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 70000) {
      await reader.cancel();
      throw new Error("Dados muito grandes.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export default {
  async fetch(request, env) {
    try {
      await authenticate(request, env);
    } catch {
      return json(
        { error: "Entre com a conta autorizada pelo Cloudflare Access." },
        401,
      );
    }
    const u = new URL(request.url),
      path = u.pathname;
    if (
      !["GET", "HEAD"].includes(request.method) &&
      request.headers.get("Origin") !== env.ADMIN_ORIGIN
    )
      return json({ error: "Origem não permitida." }, 403);
    try {
      if (path === "/api/links" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT l.*, (SELECT COUNT(*) FROM clicks c WHERE c.link_id=l.id) AS clicks FROM links l ORDER BY created_at DESC LIMIT 1000",
        ).all();
        return json(
          results.map((l) => ({
            ...l,
            real_urls: JSON.parse(l.real_urls),
            waiting_page: JSON.parse(l.waiting_page || "{}"),
          })),
        );
      }
      if (path === "/api/links" && request.method === "POST") {
        const input = await body(request),
          l = validateLink(input),
          id = crypto.randomUUID();
        const domainId = input.domain_id || null;
        if (
          domainId &&
          !(await env.DB.prepare("SELECT id FROM domains WHERE id=?")
            .bind(domainId)
            .first())
        )
          throw new Error("Domínio de cadastro inválido.");
        await env.DB.prepare(
          "INSERT INTO links(id,slug,name,mode,device,real_urls,waiting_url,waiting_page,version,domain_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
          .bind(
            id,
            l.slug,
            l.name,
            l.mode,
            l.device,
            JSON.stringify(l.real_urls),
            l.waiting_url,
            JSON.stringify(l.waiting_page),
            crypto.randomUUID(),
            domainId,
          )
          .run();
        return json({ id, ...l, domain_id: domainId }, 201);
      }
      const match = path.match(/^\/api\/links\/([a-f0-9-]+)$/);
      if (match && request.method === "PUT") {
        const l = validateLink(await body(request));
        const r = await env.DB.prepare(
          "UPDATE links SET slug=?,name=?,mode=?,device=?,real_urls=?,waiting_url=?,waiting_page=?,version=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
          .bind(
            l.slug,
            l.name,
            l.mode,
            l.device,
            JSON.stringify(l.real_urls),
            l.waiting_url,
            JSON.stringify(l.waiting_page),
            crypto.randomUUID(),
            match[1],
          )
          .run();
        return r.meta.changes
          ? json({ id: match[1], ...l })
          : json({ error: "Link não encontrado." }, 404);
      }
      if (match && request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM links WHERE id=?")
          .bind(match[1])
          .run();
        return json({ ok: true });
      }
      if (path === "/api/domains" && request.method === "GET")
        return json(
          (
            await env.DB.prepare(
              "SELECT * FROM domains ORDER BY created_at DESC",
            ).all()
          ).results,
        );
      if (path === "/api/domains" && request.method === "POST") {
        const input = await body(request),
          hostname = String(input.hostname || "")
            .trim()
            .toLowerCase();
        if (
          !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
            hostname,
          ) ||
          hostname === new URL(env.ADMIN_ORIGIN).hostname
        )
          throw new Error("Informe um domínio válido e diferente do painel.");
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO domains(id,hostname) VALUES(?,?)")
          .bind(id, hostname)
          .run();
        return json({ id, hostname, verified: 0 }, 201);
      }
      if (path === "/api/integrations/cloudflare" && request.method === "GET")
        return json({ configured: cloudflareConfigured(env) });
      const dm = path.match(
        /^\/api\/domains\/([a-f0-9-]+)(\/(?:verify|connect))?$/,
      );
      if (dm && request.method === "DELETE" && !dm[2]) {
        const connecting = await env.DB.prepare(
          "SELECT connection_lock_until FROM domains WHERE id=?",
        )
          .bind(dm[1])
          .first();
        if (connecting?.connection_lock_until > Date.now())
          return json(
            { error: "Aguarde a conexão terminar antes de excluir." },
            409,
          );
        await env.DB.prepare("DELETE FROM domains WHERE id=?")
          .bind(dm[1])
          .run();
        return json({ ok: true });
      }
      if (dm && dm[2] && request.method === "POST") {
        const domain = await env.DB.prepare("SELECT * FROM domains WHERE id=?")
          .bind(dm[1])
          .first();
        if (!domain) return json({ error: "Domínio não encontrado." }, 404);
        if (dm[2] === "/connect")
          return json(await connectDomain(env, domain, await body(request)));
        return json(await verifyDomain(env, domain));
      }
      if (path === "/api/logs" && request.method === "GET") {
        const conditions = [],
          params = [];
        const hostname = u.searchParams.get("hostname");
        if (hostname) {
          conditions.push("c.hostname=?");
          params.push(hostname);
        }
        const link = u.searchParams.get("link"),
          device = u.searchParams.get("device"),
          destination = u.searchParams.get("destination"),
          cursor = u.searchParams.get("cursor");
        for (const [field, value, allowed] of [
          ["device", device, ["mobile", "desktop"]],
          ["destination", destination, ["real", "waiting"]],
        ]) {
          if (value && !allowed.includes(value))
            throw new Error("Filtro de acesso inválido.");
          if (value) {
            conditions.push(`c.${field}=?`);
            params.push(value);
          }
        }
        if (link) {
          conditions.push("c.link_id=?");
          params.push(link);
        }
        if (cursor) {
          if (
            !/^[1-9]\d*$/.test(cursor) ||
            !Number.isSafeInteger(Number(cursor))
          )
            throw new Error("Página inválida.");
          conditions.push("c.id<?");
          params.push(Number(cursor));
        }
        for (const [field, operator] of [
          ["from", ">="],
          ["to", "<"],
        ]) {
          const date = u.searchParams.get(field);
          if (date) {
            if (
              !/^\d{4}-\d{2}-\d{2}T/.test(date) ||
              !Number.isFinite(Date.parse(date))
            )
              throw new Error("Período inválido.");
            conditions.push(`c.created_at${operator}?`);
            params.push(new Date(date).toISOString());
          }
        }
        if (
          u.searchParams.get("from") &&
          u.searchParams.get("to") &&
          Date.parse(u.searchParams.get("from")) >=
            Date.parse(u.searchParams.get("to"))
        )
          throw new Error("O início deve ser anterior ao fim do período.");
        const { results } = await env.DB.prepare(
          `SELECT c.id,c.created_at,c.hostname,c.device,c.destination,c.country,c.link_id,COALESCE(NULLIF(c.link_name,''),l.name,'Link excluído') AS link_name,COALESCE(NULLIF(c.slug,''),l.slug,'') AS slug FROM clicks c LEFT JOIN links l ON l.id=c.link_id ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY c.id DESC LIMIT 51`,
        )
          .bind(...params)
          .all();
        const items = results.slice(0, 50);
        return json({
          items,
          next_cursor: results.length > 50 ? String(items.at(-1).id) : null,
        });
      }
      if (path === "/api/domain-health" && request.method === "GET") {
        const range = period(u.searchParams);
        const { results } = await env.DB.prepare(
          `SELECT d.*,
          (SELECT COUNT(*) FROM links l WHERE l.domain_id=d.id) AS current_links,
          (SELECT COUNT(*) FROM link_events e WHERE e.domain_id=d.id AND e.event='created' AND e.created_at>=? AND e.created_at<?) AS created_links,
          (SELECT COUNT(*) FROM link_events e WHERE e.domain_id=d.id AND e.event='deleted' AND e.created_at>=? AND e.created_at<?) AS deleted_links,
          (SELECT COUNT(*) FROM clicks c WHERE c.hostname=d.hostname AND c.created_at>=? AND c.created_at<?) AS accesses,
          (SELECT MIN(created_at) FROM clicks c WHERE c.hostname=d.hostname) AS first_access,
          (SELECT MAX(created_at) FROM clicks c WHERE c.hostname=d.hostname) AS last_access,
          (SELECT COUNT(DISTINCT substr(created_at,1,10)) FROM clicks c WHERE c.hostname=d.hostname) AS used_days
          FROM domains d ORDER BY d.created_at DESC`,
        )
          .bind(
            range.from,
            range.to,
            range.from,
            range.to,
            range.from,
            range.to,
          )
          .all();
        return json({ items: results, ...range });
      }
      if (path === "/api/analytics" && request.method === "GET") {
        const range = period(u.searchParams);
        const days = Math.ceil(
          (Date.parse(range.to) - Date.parse(range.from)) / 86400000,
        );
        const since = range.from,
          link = u.searchParams.get("link") || "",
          filter = "created_at>=? AND created_at<? AND (?='' OR link_id=?)";
        const q = (sql) =>
          env.DB.prepare(sql).bind(since, range.to, link, link);
        const results = await env.DB.batch([
          q(
            `SELECT COUNT(*) total,COALESCE(SUM(destination='real'),0) real,COALESCE(SUM(destination='waiting'),0) waiting,COALESCE(SUM(device='mobile'),0) mobile FROM clicks WHERE ${filter}`,
          ),
          q(
            `SELECT substr(created_at,1,10) day,COUNT(*) total FROM clicks WHERE ${filter} GROUP BY day ORDER BY day`,
          ),
          q(
            `SELECT country,COUNT(*) total FROM clicks WHERE ${filter} GROUP BY country ORDER BY total DESC LIMIT 10`,
          ),
          q(
            `SELECT hostname,COUNT(*) total FROM clicks WHERE ${filter} GROUP BY hostname ORDER BY total DESC LIMIT 10`,
          ),
        ]);
        return json({
          summary: results[0].results[0],
          daily: results[1].results,
          countries: results[2].results,
          domains: results[3].results,
          days,
          ...range,
        });
      }
      return json({ error: "Rota não encontrada." }, 404);
    } catch (error) {
      if (error.message.includes("UNIQUE constraint"))
        return json({ error: "Este slug ou domínio já está cadastrado." }, 409);
      console.error("api_error", error.message);
      return json(
        {
          error: /D1_|SQLITE/.test(error.message)
            ? "Não foi possível salvar. Tente novamente."
            : error.message,
        },
        400,
      );
    }
  },
};
