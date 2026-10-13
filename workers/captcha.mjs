const TTL = 300;
const encoder = new TextEncoder();
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
async function context(url, link) {
  return encode(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          JSON.stringify([url.hostname, link.slug, link.id, link.version]),
        ),
      ),
    ),
  );
}
export async function issueSession(secret, scope, now = Date.now()) {
  const payload = encode(
    encoder.encode(
      JSON.stringify({ scope, exp: Math.floor(now / 1000) + TTL }),
    ),
  );
  return (
    payload +
    "." +
    encode(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          await key(secret),
          encoder.encode(payload),
        ),
      ),
    )
  );
}
export async function validSession(value, secret, scope, now = Date.now()) {
  try {
    if (!value || value.length > 1024) return false;
    const parts = value.split(".");
    if (parts.length !== 2 || !parts.every((p) => /^[\w-]+$/.test(p)))
      return false;
    const [payload, signature] = parts;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(signature),
        encoder.encode(payload),
      ))
    )
      return false;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    const seconds = Math.floor(now / 1000);
    return (
      data.scope === scope &&
      Number.isInteger(data.exp) &&
      data.exp > seconds &&
      data.exp <= seconds + TTL
    );
  } catch {
    return false;
  }
}
function record(env, ctx, link, hostname, event, reason = "") {
  ctx.waitUntil(
    env.DB.prepare(
      "INSERT INTO captcha_events(link_id,hostname,slug,event,reason,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        link.id,
        hostname,
        link.slug,
        event,
        reason,
        new Date().toISOString(),
      )
      .run()
      .catch(() => console.error("captcha_event_write_failed")),
  );
}
function page(request, siteKey, scope, message = "", status = 200) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const url = new URL(request.url);
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verificação humana</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f5f9;color:#18243a;font:16px system-ui}main{box-sizing:border-box;width:min(440px,calc(100% - 24px));padding:28px;background:white;border-radius:18px;box-shadow:0 12px 40px #18243a12}h1{font-size:26px}p{line-height:1.5}button{width:100%;padding:14px;border:0;border-radius:8px;background:#2255cc;color:white;font:inherit;cursor:pointer}button:disabled{opacity:.5}#message{color:#963818}a{color:#2255cc}</style>
<script nonce="${nonce}">function ready(){document.getElementById('continue').disabled=false;document.getElementById('message').textContent='Verificação concluída. Continue para abrir o link.'}function retry(){document.getElementById('continue').disabled=true;document.getElementById('message').textContent='A verificação expirou ou falhou. Tente novamente.'}function failed(){retry();return true}</script>
${siteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer nonce="${nonce}"></script>` : ""}</head><body><main><h1>Você não é um robô?</h1><p>Confirme a verificação abaixo para continuar.</p><p id="message" role="status" aria-live="polite">${escape(message)}</p>
${siteKey ? `<form method="post" action="${escape(url.href)}"><div class="cf-turnstile" data-sitekey="${escape(siteKey)}" data-action="cloak-link" data-cdata="${scope}" data-size="flexible" data-language="pt-br" data-callback="ready" data-expired-callback="retry" data-timeout-callback="retry" data-error-callback="failed"></div><button id="continue" disabled>Continuar</button></form>` : ""}
<p><a href="${escape(url.href)}">Tentar novamente</a></p><noscript>Ative o JavaScript para concluir a verificação.</noscript></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
async function readToken(request) {
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded") ||
    !request.body
  )
    throw new Error("invalid_request");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new Error("invalid_request");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const token = new URLSearchParams(new TextDecoder().decode(bytes)).get(
    "cf-turnstile-response",
  );
  if (!token || token.length > 2048) throw new Error("invalid_request");
  return token;
}
// Returns null only for a valid session; destination rules remain in redirect.mjs.
export async function captchaGate(request, env, ctx, link) {
  const url = new URL(request.url);
  const scope = await context(url, link);
  const cookieName = "__Host-cloak-captcha-" + scope;
  const show = (message = "", status = 200, configured = true) => {
    if (request.method !== "HEAD")
      record(env, ctx, link, url.hostname, "captcha_shown");
    return page(
      request,
      configured ? env.TURNSTILE_SITE_KEY : "",
      scope,
      message,
      status,
    );
  };
  if (
    url.protocol !== "https:" ||
    !env.TURNSTILE_SITE_KEY ||
    !env.TURNSTILE_SECRET_KEY ||
    typeof env.CAPTCHA_SESSION_SECRET !== "string" ||
    env.CAPTCHA_SESSION_SECRET.length < 32
  )
    return show(
      "A verificação está temporariamente indisponível. Tente novamente em alguns instantes.",
      503,
      false,
    );
  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  const again = (session) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: url.href,
        "Cache-Control": "no-store",
        ...(session
          ? {
              "Set-Cookie": `${cookieName}=${session}; Max-Age=${TTL}; Path=/; HttpOnly; Secure; SameSite=Lax`,
            }
          : {}),
      },
    });
  if (await validSession(cookie, env.CAPTCHA_SESSION_SECRET, scope))
    return request.method === "POST" ? again() : null;
  if (request.method !== "POST") return show();
  let reason = "invalid_request";
  try {
    if (request.headers.get("origin") !== url.origin) throw new Error("origin");
    const token = await readToken(request);
    reason = "service_unavailable";
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("service");
    const result = await response.json();
    reason = "verification_failed";
    if (
      result.success !== true ||
      result.hostname !== url.hostname ||
      result.action !== "cloak-link" ||
      result.cdata !== scope
    )
      throw new Error("verification");
    const session = await issueSession(env.CAPTCHA_SESSION_SECRET, scope);
    record(env, ctx, link, url.hostname, "captcha_passed");
    return again(session);
  } catch {
    record(env, ctx, link, url.hostname, "captcha_failed", reason);
    return show(
      reason === "service_unavailable"
        ? "Não foi possível verificar agora. Tente novamente em alguns instantes."
        : "A verificação falhou ou expirou. Faça uma nova tentativa abaixo.",
      reason === "service_unavailable" ? 503 : 400,
    );
  }
}
