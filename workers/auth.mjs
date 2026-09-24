import { createRemoteJWKSet, jwtVerify } from "jose";
export async function authenticate(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
    throw new Error("Access não configurado");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("Autenticação necessária");
  const issuer = "https://" + env.ACCESS_TEAM_DOMAIN;
  const { payload } = await jwtVerify(
    token,
    createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs")),
    { issuer, audience: env.ACCESS_AUD, algorithms: ["RS256"] },
  );
  if (payload.email?.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase())
    throw new Error("Acesso negado");
  return payload;
}
