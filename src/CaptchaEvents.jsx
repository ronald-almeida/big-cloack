import React, { useEffect, useState } from "react";

const labels = {
  captcha_shown: "Exibidas",
  captcha_passed: "Aprovadas",
  captcha_failed: "Falhas",
};
export default function CaptchaEvents({ request, rangeQuery, link }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    request(
      `captcha-events?${rangeQuery}&link=${encodeURIComponent(link || "")}`,
    )
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar as verificações.");
      });
    return () => {
      active = false;
    };
  }, [request, rangeQuery, link]);
  return (
    <section className="table-card padded">
      <h2>Verificação humana</h2>
      <p className="muted">
        Eventos de captcha no período e link selecionados. Não somam cliques e
        não alteram a classificação de tráfego.
      </p>
      {error ? (
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
