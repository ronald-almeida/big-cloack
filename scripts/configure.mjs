import { readFile, writeFile } from "node:fs/promises";
const required = [
  "CLOUDFLARE_ACCOUNT_ID",
  "D1_DATABASE_ID",
  "KV_NAMESPACE_ID",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
];
for (const name of required)
  if (!process.env[name])
    throw new Error(`Configure ${name} no ambiente antes de continuar.`);
for (const file of [
  "wrangler.api.jsonc",
  "wrangler.redirect.jsonc",
  "wrangler.jsonc",
]) {
  const config = JSON.parse(await readFile(file, "utf8"));
  config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (file === "wrangler.api.jsonc")
    config.vars.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (config.d1_databases)
    config.d1_databases[0].database_id = process.env.D1_DATABASE_ID;
  if (config.kv_namespaces)
    config.kv_namespaces[0].id = process.env.KV_NAMESPACE_ID;
  if (config.vars) {
    config.vars.ACCESS_TEAM_DOMAIN = process.env.ACCESS_TEAM_DOMAIN;
    config.vars.ACCESS_AUD = process.env.ACCESS_AUD;
  }
  await writeFile(file, JSON.stringify(config, null, 2) + "\n");
}
console.log("Configurações atualizadas. Nenhuma credencial foi gravada.");
