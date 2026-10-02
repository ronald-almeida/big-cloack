import { recordTraffic } from "./traffic.mjs";
import { captchaGate } from "./captcha.mjs";
import { deviceType, destinationMode } from "./rules.mjs";
import { renderWaitingPage } from "./waiting-page.mjs";
export default {
  async fetch(request, env, ctx) {
    const receivedAt = new Date().toISOString();
    const url = new URL(request.url);
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    if (!["GET", "HEAD", "POST"].includes(request.method))
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
        return request.method === "POST"
          ? new Response("Método não permitido", { status: 405, headers })
          : Response.json(
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
      if (request.method === "POST" && !link.captcha_enabled)
        return new Response("Método não permitido", { status: 405, headers });
      const device = deviceType(request.headers),
        mode = destinationMode(link, device),
        urls = JSON.parse(link.real_urls);
      const target =
        mode === "real" && urls.length
          ? urls[crypto.getRandomValues(new Uint32Array(1))[0] % urls.length]
          : link.waiting_url;
      if (request.method !== "POST")
        ctx.waitUntil(
          recordTraffic(
            request,
            env,
            link,
            url.hostname,
            device,
            mode,
            receivedAt,
          ).catch(() => console.error("analytics_write_failed")),
        );
      if (link.captcha_enabled) {
        const gate = await captchaGate(request, env, link);
        if (gate.response) return gate.response;
        if (gate.cookie) headers["Set-Cookie"] = gate.cookie;
      }
      if (target)
        return new Response(null, {
          status: 302,
          headers: { ...headers, Location: target },
        });
      return new Response(
        request.method === "HEAD"
          ? null
          : renderWaitingPage(JSON.parse(link.waiting_page || "{}"), link.name),
        {
          headers: {
            ...headers,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          },
        },
      );
    } catch (error) {
      console.error("redirect_failed", error.message);
      return new Response("Serviço temporariamente indisponível", {
        status: 503,
        headers,
      });
    }
  },
};
