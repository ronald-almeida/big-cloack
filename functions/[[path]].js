import { authenticate } from "../workers/auth.mjs";
export async function onRequest(context) {
  try {
    await authenticate(context.request, context.env);
  } catch {
    return new Response(
      "Acesso restrito. Entre pelo domínio administrativo protegido pelo Cloudflare Access.",
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (new URL(context.request.url).pathname.startsWith("/api/"))
    return context.env.ADMIN_API.fetch(context.request);
  const original = await context.next();
  const response = new Response(original.body, original);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  return response;
}
