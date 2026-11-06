import { renderFarm } from "./farm-render.mjs";
export const farmHostQuery = `SELECT s.*,d.hostname FROM farm_domains d JOIN farm_sites s ON s.domain_id=d.id
 WHERE d.hostname=? AND s.publish_mode='root' AND d.active=1 AND s.published_data IS NOT NULL
 UNION ALL SELECT s.*,d.hostname FROM farm_domains d JOIN farm_sites s ON s.domain_id=d.id
 WHERE d.hostname=? AND s.subdomain=? AND s.publish_mode='subdomain' AND d.active=1 AND s.published_data IS NOT NULL LIMIT 1`;
const farmPublic = {
  async fetch(request, env, { fallthrough = false } = {}) {
    const url = new URL(request.url);
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    };
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Método não permitido", { status: 405, headers });
    try {
      const site = await env.DB.prepare(
        farmHostQuery,
      )
        .bind(url.hostname, url.hostname.split('.').slice(1).join('.'), url.hostname.split('.')[0])
        .first();
      if (!site)
        return fallthrough
          ? null
          : new Response("Site não disponível", { status: 404, headers });
      if (url.pathname === "/__farm-check")
        return Response.json(
          {
            service: "big-cloack-farm",
            site_id: site.id,
            version: site.published_version,
          },
          { headers },
        );
      if (url.pathname !== "/" && url.pathname !== "/index.html")
        return new Response("Página não encontrada", { status: 404, headers });
      return new Response(
        request.method === "HEAD"
          ? null
          : renderFarm(
              JSON.parse(site.published_data),
              site.published_theme,
              site.published_head,
            ),
        { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
      );
    } catch (error) {
      console.error('farm_public_unavailable', error?.message, error?.cause?.message);
      return new Response("Site temporariamente indisponível", {
        status: 503,
        headers,
      });
    }
  },
};
export default farmPublic;
export function tryFarmPublic(request, env) {
  return farmPublic.fetch(request, env, { fallthrough: true });
}

