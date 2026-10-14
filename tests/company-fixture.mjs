import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createEngine } from "../services/company-search/engine.mjs";
export function fixtureCnpj(n) {
  let id = String(10000000 + n) + "0001";
  for (let len = 12; len <= 13; len++) {
    let sum = 0,
      w = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(id[i]) * w;
      w = w === 2 ? 9 : w - 1;
    }
    id += sum % 11 < 2 ? "0" : String(11 - (sum % 11));
  }
  return id;
}
export function companyFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../services/company-search/schema.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    "INSERT INTO metadata VALUES('ready','1'),('snapshot','test-only'),('partial','1')",
  );
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  const abertura = date.toISOString().slice(0, 10);
  for (let n = 1; n <= 35; n++)
    db.prepare("INSERT INTO companies VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      fixtureCnpj(n),
      `Empresa de Teste ${n} LTDA`,
      `Teste ${n}`,
      n > 30 ? 8 : 2,
      abertura,
      n % 2 ? "BA" : "SP",
      n % 2 ? "3849" : "7107",
      n % 2 ? "SALVADOR" : "SÃO PAULO",
      "6201501",
      "6201501 - Desenvolvimento de programas",
      "1",
      n % 3 ? "71999999999" : "",
      n % 4 ? "teste@example.com" : "",
      JSON.stringify({ fixture: true, numero: n }),
    );
  return { db, run: createEngine(db) };
}
export function onlineFixture(c) {
  return {
    cnpj: c.cnpj,
    razao_social: c.razao,
    nome_fantasia: c.fantasia,
    situacao_cadastral: c.status_code,
    data_inicio_atividade: c.abertura,
    municipio: c.cidade,
    uf: c.uf,
    cnae_fiscal: c.cnae,
    cnae_fiscal_descricao: c.atividade.replace(/^\d+ - /, ""),
    ddd_telefone_1: c.telefone,
    email: c.email,
    identificador_matriz_filial: 1,
  };
}
