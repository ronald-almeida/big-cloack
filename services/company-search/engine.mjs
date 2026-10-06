import { createHash } from "node:crypto";
import {
  searchFilters,
  quantity,
  companyAge,
} from "../../shared/companies.mjs";
const error = (s, status = 400) => Object.assign(Error(s), { status });
export function createEngine(db) {
  const meta = Object.fromEntries(
    db
      .prepare("SELECT key,value FROM metadata")
      .all()
      .map((x) => [x.key, x.value]),
  );
  if (meta.ready !== "1" || !meta.snapshot)
    throw Error("Importação oficial incompleta. Motor não iniciado.");
  db.exec(
    "CREATE TEMP TABLE IF NOT EXISTS excluded(cnpj TEXT PRIMARY KEY) WITHOUT ROWID",
  );
  const insert = db.prepare("INSERT OR IGNORE INTO excluded VALUES(?)");
  const map = ({ details, ...c }) => ({
    ...c,
    details: JSON.parse(details),
    situacao:
      { 1: "NULA", 2: "ATIVA", 3: "SUSPENSA", 4: "INAPTA", 8: "BAIXADA" }[
        c.status_code
      ] || "DESCONHECIDA",
    idade: companyAge(c.abertura),
    source: "Receita Federal — dados abertos",
    snapshot: meta.snapshot,
    state: "unused",
    verified_at: null,
  });
  return (path, input = {}) => {
    if (path.startsWith("/company/")) {
      const id = path.slice(9);
      if (!/^[0-9A-Z]{12}\d{2}$/.test(id)) throw error("CNPJ inválido.");
      const c = db.prepare("SELECT * FROM companies WHERE cnpj=?").get(id);
      if (!c) throw error("Empresa não encontrada na base oficial.", 404);
      return map(c);
    }
    if (!["/search", "/count"].includes(path))
      throw error("Rota não encontrada.", 404);
    const f = searchFilters(input.filters),
      limit = quantity(input.limit);
    const signature = createHash("sha256")
      .update(JSON.stringify(f))
      .digest("hex");
    if (
      !Array.isArray(input.exclude) ||
      input.exclude.length > 100000 ||
      input.exclude.some((x) => !/^[0-9A-Z]{12}\d{2}$/.test(x))
    )
      throw error("Exclusões inválidas.");
    db.exec("DELETE FROM excluded; BEGIN");
    try {
      for (const id of input.exclude) insert.run(id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const where = [
        "status_code=2",
        "abertura<>''",
        "abertura<=?",
        "NOT EXISTS(SELECT 1 FROM excluded e WHERE e.cnpj=companies.cnpj)",
      ],
      params = [f.opened_to];
    if (f.opened_from) {
      where.push("abertura>=?");
      params.push(f.opened_from);
    }
    for (const key of ["uf", "cnae", "matriz_filial"])
      if (f[key]) {
        where.push(key + "=?");
        params.push(f[key]);
      }
    if (f.municipio) {
      where.push(/^\d+$/.test(f.municipio) ? "municipio=?" : "cidade=?");
      params.push(f.municipio);
    }
    if (f.has_phone) where.push("telefone<>''");
    if (f.has_email) where.push("email<>''");
    if (path === "/count")
      return {
        count: db
          .prepare(
            "SELECT COUNT(*) AS n FROM companies WHERE " + where.join(" AND "),
          )
          .get(...params).n,
        snapshot: meta.snapshot,
        partial: meta.partial === "1",
      };
    if (input.cursor) {
      let c;
      try {
        c = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      } catch {
        throw error("Cursor inválido.");
      }
      if (c.snapshot !== meta.snapshot || c.signature !== signature)
        throw error("Base ou filtros alterados. Reinicie a busca.", 409);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
        !/^[0-9A-Z]{12}\d{2}$/.test(c.cnpj)
      )
        throw error("Cursor inválido.");
      where.push("(abertura,cnpj)<(?,?)");
      params.push(c.date, c.cnpj);
    }
    const rows = db
      .prepare(
        "SELECT * FROM companies WHERE " +
          where.join(" AND ") +
          " ORDER BY abertura DESC,cnpj DESC LIMIT ?",
      )
      .all(...params, limit + 1);
    const results = rows.slice(0, limit),
      last = results.at(-1);
    return {
      results: results.map(map),
      requested: limit,
      returned: results.length,
      snapshot: meta.snapshot,
      partial: meta.partial === "1",
      next_cursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({
                snapshot: meta.snapshot,
                signature,
                date: last.abertura,
                cnpj: last.cnpj,
              }),
            ).toString("base64url")
          : null,
      exhausted: rows.length <= limit,
    };
  };
}
