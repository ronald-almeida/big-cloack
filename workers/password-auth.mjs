const COOKIE = "__Host-bigcloak_session";
const LIFETIME = 7 * 86400;
const encoder = new TextEncoder();
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (text) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const now = () => Math.floor(Date.now() / 1000);
const email = (env) => env.ADMIN_EMAIL.toLowerCase();
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
function cookie(token, age = LIFETIME) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}
function sessionToken(request) {
  const value = (request.headers.get("Cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value || "") ? value : null;
}
export async function passwordSession(request, env) {
  if (new URL(request.url).origin !== env.ADMIN_ORIGIN)
    throw Error("Acesso negado");
  const token = sessionToken(request);
  if (!token) throw Error("Sessão necessária");
  const row = await env.DB.prepare(
    "SELECT s.email FROM admin_sessions s JOIN admin_credentials c ON c.email=s.email AND c.version=s.credential_version WHERE s.token_hash=? AND s.expires_at>?",
  )
    .bind(await digest(token), now())
    .first();
  if (!row || row.email !== email(env)) throw Error("Sessão expirada");
  return { email: row.email, method: "password" };
}
async function hashPassword(password, salt, env) {
  if (!env.AUTH_PASSWORD_PEPPER) throw Error("Login ainda não configurado.");
  const pepper = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_PASSWORD_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const material = await crypto.subtle.sign(
    "HMAC",
    pepper,
    encoder.encode(password),
  );
  const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, [
    "deriveBits",
  ]);
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
}
function equal(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function limited(request, env) {
  const time = now(),
    window = Math.floor(time / 900);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  // Fixed account key caps distributed attempts; hashed IPs expire after 15 minutes.
  const buckets = [
    [`ip:${await digest(ip)}:${window}`, 10],
    [`account:${window}`, 60],
  ];
  await env.DB.prepare("DELETE FROM admin_login_limits WHERE expires_at<?")
    .bind(time)
    .run();
  for (const [bucket, maximum] of buckets) {
    const row = await env.DB.prepare(
      "INSERT INTO admin_login_limits(bucket,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    )
      .bind(bucket, (window + 1) * 900)
      .first();
    if (row.attempts > maximum) return true;
  }
  return false;
}
async function issue(env, version) {
  const token = random();
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<=?")
    .bind(now())
    .run();
  await env.DB.prepare(
    "INSERT INTO admin_sessions(token_hash,email,credential_version,expires_at) VALUES(?,?,?,?)",
  )
    .bind(await digest(token), email(env), version, now() + LIFETIME)
    .run();
  return json({ email: email(env), ok: true }, 200, {
    "Set-Cookie": cookie(token),
  });
}
// All credential creation/recovery requires a verified Access identity, never public signup.
export async function passwordRoutes(request, env, readBody, verifyAccess) {
  const url = new URL(request.url),
    path = url.pathname;
  if (url.origin !== env.ADMIN_ORIGIN)
    return json({ error: "Acesso negado." }, 403);
  if (!["GET", "POST"].includes(request.method))
    return json({ error: "Método não permitido." }, 405);
  if (
    request.method === "POST" &&
    request.headers.get("Origin") !== env.ADMIN_ORIGIN
  )
    return json({ error: "Origem não permitida." }, 403);
  if (path === "/api/auth/session" && request.method === "GET") {
    try {
      return json(await passwordSession(request, env));
    } catch {
      return json({ error: "Entre para continuar." }, 401);
    }
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const token = sessionToken(request);
    if (token)
      await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?")
        .bind(await digest(token))
        .run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  if (path === "/access-recovery/api") {
    try {
      await verifyAccess(request, env);
    } catch {
      return json(
        { error: "Confirme seu e-mail administrativo para definir a senha." },
        401,
      );
    }
    if (request.method === "GET")
      return json({ email: email(env), recovery: true });
    const data = await readBody(request);
    if (
      typeof data.password !== "string" ||
      data.password.length < 12 ||
      data.password.length > 128
    )
      return json({ error: "Use uma senha entre 12 e 128 caracteres." }, 400);
    const salt = random(),
      version = random();
    const hash = await hashPassword(data.password, salt, env);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO admin_credentials(email,password_hash,salt,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,version=excluded.version,updated_at=excluded.updated_at",
      ).bind(email(env), hash, salt, version, now()),
      env.DB.prepare("DELETE FROM admin_sessions WHERE email=?").bind(
        email(env),
      ),
    ]);
    return issue(env, version);
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    if (await limited(request, env))
      return json(
        { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
        429,
        { "Retry-After": "900" },
      );
    const data = await readBody(request);
    if (
      typeof data.password !== "string" ||
      data.password.length > 128 ||
      typeof data.email !== "string" ||
      data.email.length > 254
    )
      return json({ error: "E-mail ou senha incorretos." }, 401);
    const row = await env.DB.prepare(
      "SELECT * FROM admin_credentials WHERE email=?",
    )
      .bind(email(env))
      .first();
    const hash = await hashPassword(
      data.password,
      row?.salt || "unconfigured-account",
      env,
    );
    if (
      !row ||
      !equal(hash, row.password_hash) ||
      data.email.trim().toLowerCase() !== email(env)
    )
      return json({ error: "E-mail ou senha incorretos." }, 401);
    return issue(env, row.version);
  }
  return json({ error: "Não encontrado." }, 404);
}
