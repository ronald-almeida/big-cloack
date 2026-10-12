import { readFile } from "node:fs/promises";
for (const file of [
  "wrangler.api.jsonc",
  "wrangler.redirect.jsonc",
  "wrangler.jsonc",
]) {
  const config = JSON.parse(await readFile(file, "utf8"));
  if (file !== "wrangler.jsonc" && !config.account_id)
    throw new Error("Defina a conta com node scripts/configure.mjs.");
  if (
    config.d1_databases?.some((d) =>
      /^0+$/.test(d.database_id.replaceAll("-", "")),
    )
  )
    throw new Error("Banco D1 ainda não provisionado.");
  if (config.kv_namespaces?.some((d) => /^0+$/.test(d.id)))
    throw new Error("KV ainda não provisionado.");
  if (
    file !== "wrangler.redirect.jsonc" &&
    !(config.vars?.ADMIN_ORIGIN || "").startsWith("https://")
  )
    throw new Error("Configure ADMIN_ORIGIN com HTTPS.");
}
console.log("Configurações de publicação preenchidas.");
