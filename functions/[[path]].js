export async function onRequest(context) {
  const url = new URL(context.request.url);
  // Preview hosts never serve the administrative app or its authentication API.
  if (url.origin !== context.env.ADMIN_ORIGIN) {
    return new Response(
      "Acesso restrito. Entre pelo domínio administrativo protegido pelo Cloudflare Access.",
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/access-recovery/api"
  )
    return context.env.ADMIN_API.fetch(context.request);
  const publicPage =
    url.pathname === "/login" || url.pathname.startsWith("/assets/");
  if (!publicPage) {
    const check = new URL(
      url.pathname.startsWith("/access-recovery")
        ? "/access-recovery/api"
        : "/api/auth/session",
      url,
    );
    let auth;
    try {
      auth = await context.env.ADMIN_API.fetch(
        new Request(check, { headers: context.request.headers }),
      );
    } catch {
      return new Response("Acesso temporariamente indisponível.", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (!auth.ok) {
      if (auth.status !== 401) return auth;
      return new Response(null, {
        status: 303,
        headers: { Location: "/login", "Cache-Control": "no-store" },
      });
    }
  }
  const original = await context.next();
  const response = new Response(original.body, original);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  return response;
}
