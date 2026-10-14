import React, { useEffect, useRef, useState } from "react";
import { companyAge, formCompany, isoDate } from "../shared/companies.mjs";

const displayDate = (value) => {
  if (!value) return "—";
  const dateOnly = isoDate(value),
    d = new Date(dateOnly ? dateOnly + "T12:00:00" : value);
  return Number.isFinite(+d)
    ? d.toLocaleString("pt-BR", dateOnly ? { dateStyle: "short" } : {})
    : value;
};
const names = {
  cnpj: "CNPJ",
  razao: "Razão social",
  fantasia: "Nome fantasia",
  situacao: "Situação cadastral",
  abertura: "Data de abertura",
  atividade: "Atividade",
  cidade: "Cidade",
  uf: "UF",
  telefone: "Telefone",
  email: "E-mail",
  cnae: "CNAE principal",
  matriz_filial: "Matriz/filial",
  source: "Fonte",
  snapshot: "Competência da base",
  verified_at: "Verificado em",
};
function entries(value, prefix = "") {
  return Object.entries(value || {}).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? entries(v, prefix + k + " / ")
      : [[prefix + k, String(v ?? "—")]],
  );
}
export function CompanyDetails({ company, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="farm-company-dialog"
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="company-detail-title"
    >
      <div className="farm-heading">
        <h2 id="company-detail-title">Dados do CNPJ</h2>
        <button type="button" onClick={onClose} autoFocus>
          Fechar detalhes
        </button>
      </div>
      <p>
        {company.verified_at
          ? "Consulta online à BrasilAPI. O horário informa quando o provedor foi consultado."
          : company.source
            ? "Dados do snapshot oficial. A situação será reconsultada antes do uso."
            : "Cadastro salvo no Farm. Use Verificar CNPJ no formulário para consultar a situação atual."}
      </p>
      <dl className="farm-company-details">
        {Object.entries(names).map(([key, label]) => (
          <React.Fragment key={key}>
            <dt>{label}</dt>
            <dd>
              {key === "verified_at" || key === "abertura"
                ? key === "verified_at" && !company[key]
                  ? "Não verificado online"
                  : displayDate(company[key])
                : company[key] || "—"}
            </dd>
          </React.Fragment>
        ))}
        <dt>Tempo de empresa</dt>
        <dd>{companyAge(company.abertura)}</dd>
      </dl>
      {company.details && (
        <details>
          <summary>Todos os campos retornados pela fonte</summary>
          <dl className="farm-company-details">
            {entries(company.details).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
      )}
    </dialog>
  );
}

export default function FarmCompanies({ request, onSelect, onBusy }) {
  const [filters, setFilters] = useState({
    age: "12",
    uf: "",
    municipio: "",
    cnae: "",
    matriz_filial: "",
    has_phone: false,
    has_email: false,
    opened_from: "",
    opened_to: "",
  });
  const [amount, setAmount] = useState(10),
    [rows, setRows] = useState([]),
    [cursor, setCursor] = useState(null),
    [searched, setSearched] = useState(false),
    [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState("available"),
    [history, setHistory] = useState([]),
    [historyCursor, setHistoryCursor] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [details, setDetails] = useState(null),
    [blocked, setBlocked] = useState([]);
  const pending = useRef(false);
  async function run(fn) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  function query() {
    const f = { ...filters };
    if (f.age !== "custom") {
      delete f.opened_from;
      delete f.opened_to;
    } else {
      f.age = "any";
      if (!f.opened_from || !f.opened_to)
        throw Error("Informe as duas datas do período personalizado.");
    }
    return new URLSearchParams(f).toString();
  }
  async function load(n, append = false) {
    if (append && searched && !cursor) {
      setNotice("Não há mais CNPJs disponíveis para esses filtros.");
      return;
    }
    const q = append ? searchQuery : query();
    const r = await request(
      "farm/companies/search?" +
        q +
        "&quantity=" +
        n +
        (append && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    setRows((old) =>
      append
        ? [
            ...old,
            ...r.results.filter((c) => !old.some((x) => x.cnpj === c.cnpj)),
          ]
        : r.results,
    );
    setCursor(r.next_cursor);
    setSearchQuery(q);
    setSearched(true);
    setView("available");
    setNotice(
      `${r.returned} de ${n} CNPJs encontrados. Base oficial: ${r.snapshot}${r.partial ? " (carga parcial / teste)" : ""}.` +
        (r.returned < n
          ? " A disponibilidade para esses filtros foi esgotada."
          : ""),
    );
  }
  async function list(state, append = false) {
    const r = await request(
      "farm/companies/selections?state=" +
        state +
        (append && historyCursor ? "&after=" + historyCursor : ""),
    );
    setHistory((old) => (append ? [...old, ...r.results] : r.results));
    setHistoryCursor(r.next_cursor);
    setView(state);
  }
  async function use(c) {
    try {
      const selected = await request(
        "farm/companies/company/" + c.cnpj + "/reserve",
        "POST",
        {},
      );
      await onSelect({ ...selected, data: formCompany(selected.company) });
      setRows((old) => old.filter((x) => x.cnpj !== c.cnpj));
    } catch (e) {
      if (/bloqueado|reservado|utilizado/i.test(e.message))
        setBlocked((old) => [...old, c.cnpj]);
      throw e;
    }
  }
  const shown = view === "available" ? rows : history;
  return (
    <div className="farm-card">
      <h2>Buscar CNPJs</h2>
      <p>
        Selecione empresas ativas na base oficial. Cada CNPJ será revalidado
        online antes de abrir Criar site.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => load(Number(amount)));
        }}
      >
        <fieldset disabled={busy} className="farm-grid">
          <label>
            Quantidade desejada
            <input
              type="number"
              min="1"
              max="100"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Tempo de empresa
            <select
              value={filters.age}
              onChange={(e) => setFilters({ ...filters, age: e.target.value })}
            >
              {[
                ["3", "Últimos 3 meses"],
                ["6", "Últimos 6 meses"],
                ["12", "Últimos 12 meses"],
                ["24", "Últimos 24 meses"],
                ["any", "Qualquer idade"],
                ["custom", "Personalizado"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {filters.age === "custom" && (
            <>
              <label>
                Abertura a partir de
                <input
                  type="date"
                  required
                  value={filters.opened_from}
                  onChange={(e) =>
                    setFilters({ ...filters, opened_from: e.target.value })
                  }
                />
              </label>
              <label>
                Abertura até
                <input
                  type="date"
                  required
                  value={filters.opened_to}
                  onChange={(e) =>
                    setFilters({ ...filters, opened_to: e.target.value })
                  }
                />
              </label>
            </>
          )}
          <label>
            UF
            <input
              maxLength="2"
              placeholder="BA"
              value={filters.uf}
              onChange={(e) =>
                setFilters({ ...filters, uf: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Município
            <input
              placeholder="Nome exato ou código Receita"
              value={filters.municipio}
              onChange={(e) =>
                setFilters({ ...filters, municipio: e.target.value })
              }
            />
          </label>
          <label>
            CNAE principal
            <input
              placeholder="7 dígitos"
              value={filters.cnae}
              onChange={(e) => setFilters({ ...filters, cnae: e.target.value })}
            />
          </label>
          <label>
            Estabelecimento
            <select
              value={filters.matriz_filial}
              onChange={(e) =>
                setFilters({ ...filters, matriz_filial: e.target.value })
              }
            >
              <option value="">Matriz e filial</option>
              <option value="1">Matriz</option>
              <option value="2">Filial</option>
            </select>
          </label>
          <label className="farm-check">
            <input
              type="checkbox"
              checked={filters.has_phone}
              onChange={(e) =>
                setFilters({ ...filters, has_phone: e.target.checked })
              }
            />
            Com telefone
          </label>
          <label className="farm-check">
            <input
              type="checkbox"
              checked={filters.has_email}
              onChange={(e) =>
                setFilters({ ...filters, has_email: e.target.checked })
              }
            />
            Com e-mail
          </label>
          <button className="primary">
            {busy ? "Consultando…" : "Buscar CNPJs"}
          </button>
        </fieldset>
      </form>
      <div className="farm-tabs" aria-label="Situação de uso">
        {[
          ["available", "Disponíveis"],
          ["used", "Utilizados"],
          ["reserved", "Reservados"],
        ].map(([v, l]) => (
          <button
            key={v}
            disabled={busy}
            aria-pressed={view === v}
            className={view === v ? "primary" : ""}
            onClick={() =>
              v === "available" ? setView(v) : run(() => list(v))
            }
          >
            {l}
            {v === "available" ? ` (${rows.length})` : ""}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Empresa / CNPJ</th>
              <th>Situação / abertura</th>
              <th>Local / atividade</th>
              <th>Contato</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.cnpj}>
                <td>
                  <strong>{c.fantasia || c.razao}</strong>
                  <br />
                  {c.razao}
                  <br />
                  {c.cnpj}
                </td>
                <td>
                  {c.situacao || "Consultar"}
                  <br />
                  {displayDate(c.abertura)}
                  <br />
                  {companyAge(c.abertura)}
                  <br />
                  {view === "reserved" &&
                    `Reserva até ${displayDate(new Date(c.reserved_until).toISOString())}`}
                </td>
                <td>
                  {c.cidade} / {c.uf}
                  <br />
                  {c.atividade}
                </td>
                <td>
                  {c.telefone ? "✓ Telefone" : "Sem telefone"}
                  <br />
                  {c.email ? "✓ E-mail" : "Sem e-mail"}
                </td>
                <td>
                  <div className="farm-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () =>
                          setDetails(
                            view === "available"
                              ? await request(
                                  "farm/companies/company/" + c.cnpj,
                                )
                              : c,
                          ),
                        )
                      }
                    >
                      Verificar dados
                    </button>
                    {view === "available" && (
                      <>
                        <button
                          className="primary"
                          disabled={busy || blocked.includes(c.cnpj)}
                          onClick={() => run(() => use(c))}
                        >
                          Usar CNPJ
                        </button>
                        {blocked.includes(c.cnpj) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await load(1, true);
                                setRows((old) =>
                                  old.filter((x) => x.cnpj !== c.cnpj),
                                );
                              })
                            }
                          >
                            Buscar outro elegível
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && (
        <p>
          {searched || view !== "available"
            ? "Nenhum CNPJ nesta visão."
            : "Escolha os filtros e a quantidade para começar."}
        </p>
      )}
      {view === "available" && searched && (
        <button
          disabled={busy || !cursor}
          onClick={() => run(() => load(Number(amount), true))}
        >
          Buscar mais {amount}
        </button>
      )}
      {view !== "available" && historyCursor && (
        <button disabled={busy} onClick={() => run(() => list(view, true))}>
          Carregar mais
        </button>
      )}
      {details && (
        <CompanyDetails company={details} onClose={() => setDetails(null)} />
      )}
    </div>
  );
}
