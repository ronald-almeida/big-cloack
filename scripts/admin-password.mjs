import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { credentialSql } from "./admin-credential.mjs";

// No password arguments, files, logs, or public bootstrap endpoint.
if (!process.stdin.isTTY) throw Error("Execute em um terminal interativo.");
if (!process.argv.includes("--remote") && !process.argv.includes("--local"))
  throw Error("Escolha explicitamente --remote (produção) ou --local.");
if (process.argv.includes("--remote") && process.argv.includes("--local"))
  throw Error("Escolha apenas um destino.");
const config = JSON.parse(await readFile("wrangler.api.jsonc", "utf8"));
let muted = false;
const output = new Writable({
  write(chunk, encoding, cb) {
    if (!muted) process.stderr.write(chunk, encoding);
    cb();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
function hidden(label) {
  process.stderr.write(label);
  muted = true;
  return new Promise((resolve) =>
    rl.question("", (answer) => {
      muted = false;
      process.stderr.write("\n");
      resolve(answer);
    }),
  );
}
let password, confirm, pepper;
try {
  process.stderr.write(`Administrador: ${config.vars.ADMIN_EMAIL}\n`);
  pepper = await hidden("AUTH_PASSWORD_PEPPER atual (entrada oculta): ");
  if (pepper.length < 32)
    throw Error(
      "Use um pepper aleatório com pelo menos 32 caracteres, igual ao secret da API.",
    );
  password = await hidden("Nova senha (12–128 caracteres, entrada oculta): ");
  confirm = await hidden("Confirme a senha: ");
  if (password !== confirm || password.length < 12 || password.length > 128)
    throw Error("As senhas precisam ser iguais e ter de 12 a 128 caracteres.");
} finally {
  rl.close();
}
const sql = await credentialSql(config.vars.ADMIN_EMAIL, password, pepper);
password = confirm = pepper = undefined;
const dir = await mkdtemp(resolve(".wrangler-admin-"));
try {
  const file = join(dir, "credential.sql");
  await writeFile(file, sql, { mode: 0o600 });
  const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        wrangler,
        "d1",
        "execute",
        "DB",
        process.argv.includes("--remote") ? "--remote" : "--local",
        "-c",
        "wrangler.api.jsonc",
        "--file",
        file,
        "--yes",
      ],
      { stdio: "inherit", shell: false },
    );
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0)
    throw Error(
      "Falha ao atualizar a credencial. Confira o resultado do Wrangler antes de tentar novamente.",
    );
  console.log("Credencial atualizada; sessões anteriores revogadas.");
} finally {
  if (
    dirname(dir) !== resolve(".") ||
    !basename(dir).startsWith(".wrangler-admin-")
  )
    throw Error("Caminho temporário inesperado; limpeza interrompida.");
  await rm(dir, { recursive: true, force: true });
}
