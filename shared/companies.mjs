// Receita's modulo-11 algorithm: numeric and alphanumeric registrations.
export function normalizeFarmCnpj(value) {
  const id = String(value || "")
    .replace(/[.\/\-\s]/g, "")
    .toUpperCase();
  if (!/^[A-Z0-9]{12}\d{2}$/.test(id) || /^(.)\1+$/.test(id))
    throw Error("Informe um CNPJ válido com 14 caracteres.");
  for (let length = 12; length <= 13; length++) {
    let sum = 0,
      weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += (id.charCodeAt(i) - 48) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    if ((sum % 11 < 2 ? 0 : 11 - (sum % 11)) !== Number(id[length]))
      throw Error("CNPJ inválido. Confira os dígitos.");
  }
  return id;
}
export function isoDate(value) {
  const s = String(value || "").replace(
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    "$3-$2-$1",
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s ? s : "";
}
export function companyAge(value, now = new Date()) {
  const date = isoDate(value);
  if (!date) return "Não informada";
  const d = new Date(date + "T00:00:00Z");
  if (d > now) return "Data futura";
  const months =
    (now.getUTCFullYear() - d.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    d.getUTCMonth() -
    (now.getUTCDate() < d.getUTCDate() ? 1 : 0);
  if (months < 1) {
    const days = Math.floor((now - d) / 86400000);
    return `${days} ${days === 1 ? "dia" : "dias"}`;
  }
  return months < 12
    ? `${months} ${months === 1 ? "mês" : "meses"}`
    : `${Math.floor(months / 12)} ${months < 24 ? "ano" : "anos"} e ${months % 12} ${months % 12 === 1 ? "mês" : "meses"}`;
}
export function searchFilters(input = {}, now = new Date()) {
  const out = {};
  for (const key of ["opened_from", "opened_to"]) {
    if (input[key] && !isoDate(input[key]))
      throw Error("Data de abertura inválida.");
    out[key] = isoDate(input[key]);
  }
  if (!out.opened_from && !out.opened_to && input.age !== "any") {
    const months =
      input.age == null || input.age === "" ? 12 : Number(input.age);
    if (!Number.isInteger(months) || months < 1 || months > 1200)
      throw Error("Período inválido.");
    const d = new Date(now);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - months);
    d.setUTCDate(
      Math.min(
        day,
        new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
    out.opened_from = d.toISOString().slice(0, 10);
  }
  out.opened_to ||= now.toISOString().slice(0, 10);
  if (out.opened_from > out.opened_to)
    throw Error("O início deve anteceder o fim do período.");
  out.uf = String(input.uf || "")
    .trim()
    .toUpperCase();
  if (
    out.uf &&
    !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(
      out.uf,
    )
  )
    throw Error("UF inválida.");
  out.municipio = String(input.municipio || "")
    .trim()
    .toUpperCase();
  if (out.municipio.length > 100) throw Error("Município inválido.");
  out.cnae = String(input.cnae || "").replace(/[.\/-]/g, "");
  if (out.cnae && !/^\d{7}$/.test(out.cnae))
    throw Error("Informe os 7 dígitos do CNAE principal.");
  out.matriz_filial = String(input.matriz_filial || "");
  if (out.matriz_filial && !["1", "2"].includes(out.matriz_filial))
    throw Error("Matriz/filial inválido.");
  for (const key of ["has_phone", "has_email"]) {
    if (
      input[key] != null &&
      ![true, false, "true", "false", ""].includes(input[key])
    )
      throw Error("Filtro de contato inválido.");
    out[key] = input[key] === true || input[key] === "true";
  }
  return out;
}
export function quantity(value, fallback = 10) {
  const n = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100)
    throw Error("Escolha uma quantidade de 1 a 100.");
  return n;
}
export function formCompany(c) {
  return {
    ...c,
    abertura: isoDate(c.abertura).replace(
      /^(\d{4})-(\d{2})-(\d{2})$/,
      "$3/$2/$1",
    ),
  };
}
