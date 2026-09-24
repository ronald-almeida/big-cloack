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
          results.map((l) => ({ ...l, real_urls: JSON.parse(l.real_urls) })),
        );
      }
      if (path === "/api/links" && request.method === "POST") {
        const l = validateLink(await body(request)),
          id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO links(id,slug,name,mode,device,real_urls,waiting_url,version) VALUES(?,?,?,?,?,?,?,?)",
        )
          .bind(
            id,
            l.slug,
            l.name,
            l.mode,
            l.device,
            JSON.stringify(l.real_urls),
            l.waiting_url,
            crypto.randomUUID(),
          )
          .run();
        return json({ id, ...l }, 201);
      }
      const match = path.match(/^\/api\/links\/([a-f0-9-]+)$/);
      if (match && request.method === "PUT") {
        const l = validateLink(await body(request));
        const r = await env.DB.prepare(
          "UPDATE links SET slug=?,name=?,mode=?,device=?,real_urls=?,waiting_url=?,version=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        )
          .bind(
            l.slug,
            l.name,
            l.mode,
            l.device,
            JSON.stringify(l.real_urls),
            l.waiting_url,
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
      const dm = path.match(/^\/api\/domains\/([a-f0-9-]+)(\/verify)?$/);
      if (dm && request.method === "DELETE" && !dm[2]) {
        await env.DB.prepare("DELETE FROM domains WHERE id=?")
          .bind(dm[1])
          .run();
        return json({ ok: true });
      }
      if (dm && dm[2] && request.method === "POST") {
        const d = await env.DB.prepare("SELECT * FROM domains WHERE id=?")
          .bind(dm[1])
          .first();
        if (!d) return json({ error: "Domínio não encontrado." }, 404);
        let verified = false;
        try {
          const res = await fetch("https://" + d.hostname + "/__domain-check", {
            redirect: "manual",
            signal: AbortSignal.timeout(7000),
          });
          if (
            res.ok &&
            res.headers.get("content-type")?.includes("application/json")
          ) {
            const data = await body(res);
            verified =
              data.service === "big-cloack-redirect" && data.domain_id === d.id;
          }
        } catch {}
        await env.DB.prepare("UPDATE domains SET verified=? WHERE id=?")
          .bind(verified ? 1 : 0, d.id)
          .run();
        return verified
          ? json({ ok: true })
          : json(
              {
                error:
                  "Conecte este domínio ao Worker big-cloack-redirect em Cloudflare → Workers → Settings → Domains & Routes e tente novamente.",
              },
              422,
            );
      }
      if (path === "/api/analytics" && request.method === "GET") {
        const days = [7, 30, 90].includes(Number(u.searchParams.get("days")))
          ? Number(u.searchParams.get("days"))
          : 30;
        const since = new Date(Date.now() - days * 86400000).toISOString(),
          link = u.searchParams.get("link") || "",
          filter = "created_at>=? AND (?='' OR link_id=?)";
        const q = (sql) => env.DB.prepare(sql).bind(since, link, link);
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
