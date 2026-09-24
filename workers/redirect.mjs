import { deviceType, destinationMode } from "./rules.mjs";
const waiting =
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Em breve</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f7fa;font:18px system-ui;color:#172033"><main style="text-align:center;padding:32px"><p style="color:#5671e8">●</p><h1>Estamos preparando tudo.</h1><p>Este conteúdo estará disponível em breve.</p></main></body></html>';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Método não permitido", { status: 405, headers });
    try {
      const domain = await env.DB.prepare(
        "SELECT id,verified FROM domains WHERE hostname=?",
      )
        .bind(url.hostname)
        .first();
      if (!domain)
        return new Response("Domínio não cadastrado", { status: 404, headers });
      if (url.pathname === "/__domain-check")
        return Response.json(
          { service: "big-cloack-redirect", domain_id: domain.id },
          { headers },
        );
      if (!domain.verified)
        return new Response("Domínio pendente de verificação", {
          status: 404,
          headers,
        });
      const slug = url.pathname.slice(1);
      const meta = await env.DB.prepare(
        "SELECT id,version FROM links WHERE slug=?",
      )
        .bind(slug)
        .first();
      if (!meta)
        return new Response("Link não encontrado", { status: 404, headers });
      // D1 is authoritative; versioned KV keys cannot resurrect deleted or edited links.
      const key = "link:" + meta.id + ":" + meta.version;
      let link = await env.CACHE.get(key, "json");
      if (!link) {
        link = await env.DB.prepare(
          "SELECT * FROM links WHERE id=? AND version=?",
        )
          .bind(meta.id, meta.version)
          .first();
        if (!link)
          return new Response("Tente novamente", { status: 503, headers });
        ctx.waitUntil(
          env.CACHE.put(key, JSON.stringify(link), { expirationTtl: 3600 }),
        );
      }
      const device = deviceType(request.headers),
        mode = destinationMode(link, device),
        urls = JSON.parse(link.real_urls);
      const target =
        mode === "real" && urls.length
          ? urls[crypto.getRandomValues(new Uint32Array(1))[0] % urls.length]
          : link.waiting_url;
      if (request.method === "GET")
        ctx.waitUntil(
          env.DB.prepare(
            "INSERT INTO clicks(link_id,hostname,device,destination,country) VALUES(?,?,?,?,?)",
          )
            .bind(
              link.id,
              url.hostname,
              device,
              mode,
              request.cf?.country || "XX",
            )
            .run()
            .catch((error) =>
              console.error("analytics_write_failed", error.message),
            ),
        );
      if (target)
        return new Response(null, {
          status: 302,
          headers: { ...headers, Location: target },
        });
      return new Response(request.method === "HEAD" ? null : waiting, {
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        },
      });
    } catch (error) {
      console.error("redirect_failed", error.message);
      return new Response("Serviço temporariamente indisponível", {
        status: 503,
        headers,
      });
    }
  },
};
