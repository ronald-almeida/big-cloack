// Independent of traffic classification and destination selection. No tokens in logs.
const TTL = 300;
const ACTION = "cloak_link";
const encoder = new TextEncoder();
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const base64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function unbase64(s) {
  if (!/^[\w-]+$/.test(s)) throw new Error("Invalid encoding");
  return Uint8Array.from(
    atob(s.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
async function binding(link, hostname) {
  return base64(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(JSON.stringify([link.id, link.version, hostname])),
    ),
  );
}
const cookieName = (link) => "__Host-cloak-human-" + link.id;
export async function createCaptchaSession(
  link,
  hostname,
  secret,
  now = Date.now(),
) {
  const value = base64(
    encoder.encode(
      JSON.stringify({
        b: await binding(link, hostname),
        exp: Math.floor(now / 1000) + TTL,
      }),
    ),
  );
  const signature = base64(
    await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(value)),
  );
  return `${cookieName(link)}=${value}.${signature}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Lax`;
}
export async function validCaptchaSession(
  request,
  link,
  secret,
  now = Date.now(),
) {
  try {
    const cookie = (request.headers.get("Cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName(link) + "="));
    const raw = cookie?.slice(cookieName(link).length + 1);
    if (!raw || raw.length > 1024) return false;
    const parts = raw.split(".");
    if (parts.length !== 2) return false;
    const [value, signature] = parts;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        unbase64(signature),
        encoder.encode(value),
      ))
    )
      return false;
    const payload = JSON.parse(new TextDecoder().decode(unbase64(value)));
    const seconds = Math.floor(now / 1000);
    return (
      Number.isInteger(payload.exp) &&
      payload.exp > seconds &&
      payload.exp <= seconds + TTL &&
      payload.b === (await binding(link, new URL(request.url).hostname))
    );
  } catch {
    return false;
  }
}
function event(name, link, hostname, reason) {
  console.info(
    JSON.stringify({
      event: name,
      link_id: link.id,
      hostname,
      ...(reason ? { reason } : {}),
    }),
  );
}
function page(
  request,
  sitekey,
  cdata,
  message = "Confirme a verificação abaixo para continuar.",
  status = 200,
) {
  const nonce = base64(crypto.getRandomValues(new Uint8Array(18)));
  // Relative form action, derived only from the current URL, cannot send tokens to a destination URL.
  const action = new URL(request.url).pathname;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verificação humana</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6fa;color:#172337;font:16px system-ui,sans-serif}main{box-sizing:border-box;width:min(440px,calc(100% - 32px));padding:32px;background:white;border:1px solid #e1e7ef;border-radius:20px;box-shadow:0 12px 40px #1723370a}h1{font-size:26px;line-height:1.25}p{line-height:1.6;color:#536174}button{width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#2558d5;color:white;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}a{color:#2558d5}.cf-turnstile{min-height:65px}</style></head><body><main><h1>Você não é um robô?</h1><p id="message" role="status" aria-live="polite">${escape(message)}</p>
${sitekey ? `<form method="post" action="${escape(action)}"><div class="cf-turnstile" data-sitekey="${escape(sitekey)}" data-action="${ACTION}" data-cdata="${escape(cdata)}" data-language="pt-BR" data-size="flexible" data-callback="passed" data-expired-callback="expired" data-error-callback="failed" data-timeout-callback="expired"></div><button id="continue" disabled>Continuar</button></form><noscript><p>Ative o JavaScript para concluir a verificação.</p></noscript><script nonce="${nonce}">const button=document.getElementById('continue'),message=document.getElementById('message');window.passed=()=>{button.disabled=false;message.textContent='Verificação concluída. Clique em Continuar.'};window.expired=()=>{button.disabled=true;message.textContent='A verificação expirou. Confirme novamente.'};window.failed=()=>{button.disabled=true;message.textContent='Não foi possível verificar. Tente novamente ou recarregue a página.'};window.addEventListener('error',event=>{if(event.target?.id==='turnstile-script') window.failed()},true);setTimeout(()=>{if(!window.turnstile) window.failed()},15000);document.querySelector('form').addEventListener('submit',()=>{button.disabled=true;button.textContent='Verificando…'});</script><script id="turnstile-script" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}
<p><a href="${escape(action)}">Tentar novamente</a></p></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // Keep Origin on the same-origin form POST; still hide referrers externally.
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
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
    return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const tokens = new URLSearchParams(new TextDecoder().decode(bytes)).getAll(
    "cf-turnstile-response",
  );
  return tokens.length === 1 && tokens[0].length > 0 && tokens[0].length <= 2048
    ? tokens[0]
    : null;
}
// A response stops the request; a cookie means validation passed and normal routing may proceed.
export async function captchaGate(request, env, link) {
  const url = new URL(request.url);
  const sitekey = env.TURNSTILE_SITE_KEY;
  const secret = env.TURNSTILE_SECRET_KEY;
  const sessionSecret = env.CAPTCHA_SESSION_SECRET;
  if (
    !sitekey ||
    !secret ||
    typeof sessionSecret !== "string" ||
    sessionSecret.length < 32 ||
    url.protocol !== "https:"
  ) {
    return {
      response: page(
        request,
        "",
        "",
        "A verificação está temporariamente indisponível. Tente novamente em alguns instantes.",
        503,
      ),
    };
  }
  if (
    request.method !== "POST" &&
    (await validCaptchaSession(request, link, sessionSecret))
  )
    return {};
  const cdata = await binding(link, url.hostname);
  if (request.method !== "POST") {
    event("captcha_shown", link, url.hostname);
    return { response: page(request, sitekey, cdata) };
  }
  const fail = (reason, message, status = 400) => {
    event("captcha_failed", link, url.hostname, reason);
    return { response: page(request, sitekey, cdata, message, status) };
  };
  if (request.headers.get("Origin") !== url.origin)
    return fail("origin", "Recarregue a página para tentar novamente.", 403);
  // Reloading an internal waiting page can resubmit the POST. Its valid session
  // must avoid a second Siteverify call with the already consumed token.
  if (await validCaptchaSession(request, link, sessionSecret)) return {};
  let token;
  try {
    token = await readToken(request);
  } catch {
    token = null;
  }
  if (!token)
    return fail("invalid_request", "Conclua a verificação para continuar.");
  let result;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response: token }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("Unavailable");
    result = await response.json();
    if (!result || typeof result !== "object")
      throw new Error("Invalid response");
  } catch {
    return fail(
      "unavailable",
      "Não foi possível verificar agora. Tente novamente em alguns instantes.",
      503,
    );
  }
  if (
    result.success !== true ||
    result.hostname !== url.hostname ||
    result.action !== ACTION ||
    result.cdata !== cdata
  ) {
    const expired =
      Array.isArray(result["error-codes"]) &&
      result["error-codes"].includes("timeout-or-duplicate");
    return fail(
      expired ? "expired_or_used" : "invalid",
      expired
        ? "A verificação expirou ou já foi usada. Confirme novamente."
        : "Não foi possível confirmar a verificação. Tente novamente.",
    );
  }
  const cookie = await createCaptchaSession(link, url.hostname, sessionSecret);
  event("captcha_passed", link, url.hostname);
  return { cookie };
}

