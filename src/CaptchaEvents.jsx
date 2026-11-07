import React from "react";
import useLiveQuery, { getJSON } from "./useLiveQuery.js";
import LiveStatus from "./LiveStatus.jsx";

const labels = {
  captcha_shown: "Exibidas",
  captcha_passed: "Aprovadas",
  captcha_failed: "Falhas",
};
export default function CaptchaEvents({ rangeQuery, link }) {
  const query = `${rangeQuery}&link=${encodeURIComponent(link || "")}`;
  const live = useLiveQuery(
    query,
    (signal) => getJSON("/api/captcha-events?" + query, signal),
    Boolean(rangeQuery),
  );
  const { data, error } = live;
  return (
    <section className="table-card padded">
      <h2>Verificação humana</h2>
      <p className="muted">
        Eventos de captcha no período e link selecionados. Não somam cliques e
        não alteram a classificação de tráfego.
      </p>
      {rangeQuery && <LiveStatus {...live} />}
      {!rangeQuery ? (
        <p>Selecione um período válido.</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>Carregando...</p>
      ) : (
        <>
          {Object.entries(labels).map(([event, label]) => (
            <div className="metric-row" key={event}>
              <span>{label}</span>
              <b>
                {data.totals.find((row) => row.event === event)?.total || 0}
              </b>
            </div>
          ))}
          <details>
            <summary>Últimos eventos (até 50)</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Link</th>
                    <th>Evento</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {new Date(row.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td>
                        {row.hostname}/{row.slug}
                      </td>
                      <td>{row.event}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
