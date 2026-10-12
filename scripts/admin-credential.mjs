import { hashPassword } from "../workers/password-auth.mjs";

// Only used by the operator's CLI, never imported into the public Worker.
export async function credentialSql(email, password, pepper) {
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254
  )
    throw Error("ADMIN_EMAIL inválido.");
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw Error("Use uma senha de 12 a 128 caracteres.");
  if (typeof pepper !== "string" || pepper.length < 32)
    throw Error(
      "Use o pepper configurado na API, com pelo menos 32 caracteres.",
    );
  const salt = crypto.randomUUID() + crypto.randomUUID();
  const version = crypto.randomUUID();
  const hash = await hashPassword(password, salt, {
    AUTH_PASSWORD_PEPPER: pepper,
  });
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const user = email.trim().toLowerCase();
  return `INSERT INTO admin_credentials(email,password_hash,salt,version,updated_at)
VALUES(${quote(user)},${quote(hash)},${quote(salt)},${quote(version)},${Math.floor(Date.now() / 1000)})
ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,version=excluded.version,updated_at=excluded.updated_at;
DELETE FROM admin_sessions;
DELETE FROM admin_credentials WHERE email<>${quote(user)};
`;
}
