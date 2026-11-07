import useLiveQuery, { getJSON } from "./useLiveQuery.js";
import LiveStatus from "./LiveStatus.jsx";
import React, { useState } from "react";
import AccessLogs from "./AccessLogs.jsx";
const date = (v) =>
  v ? new Date(v).toLocaleString("pt-BR") : "Ainda sem acessos";
export default function DomainHealth({ links, domains, rangeQuery }) {
  const [selected, setSelected] = useState("");
  const live = useLiveQuery(
    rangeQuery,
    (signal) => getJSON("/api/domain-health?" + rangeQuery, signal),
    Boolean(rangeQuery),
  );
  const items = live.data?.items || [],
    error = live.error,
    loading = live.loading;
  return (
    <section className="domain-health">
      <div className="section-heading">
        <div>
          <h2>Saúde e uso dos domínios</h2>
          <p>Criações, exclusões e acessos no período selecionado.</p>
        </div>
      </div>
      {rangeQuery && <LiveStatus {...live} />}
      <details className="metric-help">
        <summary>Como as métricas são calculadas</summary>
        <p className="logs-timezone">
          O tempo de uso começa no primeiro acesso registrado. Dias com acessos
          são contados em UTC; não medem disponibilidade contínua. Criações e
          exclusões usam o domínio de cadastro e passam a ser registradas nesta
          atualização.
        </p>
      </details>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && <p role="status">Carregando métricas...</p>}
      {items.map((d) => (
        <article className="table-card health-card" key={d.id}>
          <div className="section-heading">
            <h3>{d.hostname}</h3>
            <span className={"badge " + (d.verified ? "real" : "waiting")}>
              {d.verified ? "Conectado" : "Conexão pendente"}
            </span>
          </div>
          <div className="health-metrics">
            {[
              [
                "Tempo desde o primeiro acesso",
                d.first_access
                  ? `${Math.max(0, Math.floor((Date.now() - Date.parse(d.first_access)) / 86400000))} dias`
                  : "Sem uso registrado",
              ],
              ["Dias com acessos (total)", d.used_days],
              ["Links cadastrados atualmente", d.current_links],
              ["Links criados no período", d.created_links],
              ["Links excluídos no período", d.deleted_links],
              ["Acessos no período", d.accesses],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p>
            Cadastrado em: {date(d.created_at)} · Primeiro acesso:{" "}
            {date(d.first_access)} · Último acesso: {date(d.last_access)}
          </p>
          <button
            className="secondary"
            onClick={() =>
              setSelected(selected === d.hostname ? "" : d.hostname)
            }
          >
            {selected === d.hostname
              ? "Fechar histórico"
              : "Ver histórico de acessos"}
          </button>
          {selected === d.hostname && (
            <AccessLogs
              links={links}
              rangeQuery={rangeQuery}
              hostname={d.hostname}
            />
          )}
        </article>
      ))}
      {!loading && !items.length && !error && (
        <p>
          {rangeQuery
            ? "As métricas aparecerão após cadastrar um domínio."
            : "Selecione um período válido para consultar as métricas."}
        </p>
      )}
    </section>
  );
}
