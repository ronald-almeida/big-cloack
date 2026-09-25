import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, Smartphone, Monitor, Clock3 } from "lucide-react";
export default function AccessLogs({
  links,
  domains = [],
  rangeQuery = "",
  hostname = "",
}) {
  const [filters, setFilters] = useState({
      link: "",
      device: "",
      destination: "",
      hostname: "",
    }),
    [items, setItems] = useState([]),
    [cursor, setCursor] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const request = useRef(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const format = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: timezone,
  });
  async function load(next, signal) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(rangeQuery);
      for (const [key, value] of Object.entries(filters))
        if (value)
          query.set(
            key,
            ["from", "to"].includes(key)
              ? new Date(value).toISOString()
              : value,
          );
      if (hostname) query.set("hostname", hostname);
      if (next) query.set("cursor", next);
      const res = await fetch("/api/logs?" + query, { signal });
      if (!res.headers.get("content-type")?.includes("application/json"))
        throw new Error("Atualize a página para entrar novamente.");
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Não foi possível carregar os acessos.");
      if (!signal.aborted) {
        setItems((previous) =>
          next ? [...previous, ...data.items] : data.items,
        );
        setCursor(data.next_cursor);
      }
    } catch (e) {
      if (!signal.aborted) setError(e.message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setItems([]);
    setCursor(null);
    if (rangeQuery) load(null, controller.signal);
    else setLoading(false);
    return () => controller.abort();
  }, [filters, reload, rangeQuery, hostname]);
  const change = (key, value) => setFilters({ ...filters, [key]: value });
  return (
    <section className="table-card logs-card">
      <div className="section-heading">
        <div>
          <h2>Histórico de acessos</h2>
          <p>
            Cada abertura de link, do acesso mais recente para o mais antigo.
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setReload((x) => x + 1)}
        >
          <RefreshCw size={15} />
          Atualizar
        </button>
      </div>
      <div className="logs-filters">
        <label>
          Link
          <select
            value={filters.link}
            onChange={(e) => change("link", e.target.value)}
          >
            <option value="">Todos os links</option>
            {links.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dispositivo
          <select
            value={filters.device}
            onChange={(e) => change("device", e.target.value)}
          >
            <option value="">Todos</option>
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
          </select>
        </label>
        <label>
          Destino
          <select
            value={filters.destination}
            onChange={(e) => change("destination", e.target.value)}
          >
            <option value="">Real e Espera</option>
            <option value="real">Real</option>
            <option value="waiting">Espera</option>
          </select>
        </label>
        {!hostname && (
          <label>
            Domínio
            <select
              value={filters.hostname}
              onChange={(e) => change("hostname", e.target.value)}
            >
              <option value="">Todos os domínios</option>
              {domains.map((d) => (
                <option key={d.id} value={d.hostname}>
                  {d.hostname}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="logs-timezone">
        Horário local: {timezone}. Registros de abertura (GET); não representam
        visitantes únicos.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>DATA E HORA</th>
              <th>LINK</th>
              <th>DISPOSITIVO</th>
              <th>DESTINO</th>
              <th>DOMÍNIO</th>
              <th>PAÍS</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <time dateTime={item.created_at}>
                    {format.format(new Date(item.created_at))}
                  </time>
                </td>
                <td>
                  <b>{item.link_name}</b>
                  <small>/{item.slug}</small>
                </td>
                <td>
                  <span className="device-label">
                    {item.device === "mobile" ? (
                      <Smartphone size={15} />
                    ) : (
                      <Monitor size={15} />
                    )}{" "}
                    {item.device === "mobile" ? "Mobile" : "Desktop"}
                  </span>
                </td>
                <td>
                  <span className={"badge " + item.destination}>
                    {item.destination === "real" ? "Real" : "Espera"}
                  </span>
                </td>
                <td>{item.hostname}</td>
                <td>
                  {item.country === "XX" ? "Não identificado" : item.country}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && !loading && !error && (
        <div className="empty">
          <Clock3 size={28} />
          <h3>Nenhum acesso neste período</h3>
          <p>Os acessos aparecerão aqui quando seus links forem abertos.</p>
        </div>
      )}
      <footer>
        <span>{items.length} registros exibidos</span>
        {loading ? (
          <span role="status">Carregando acessos...</span>
        ) : (
          cursor && (
            <button
              className="secondary"
              onClick={() => load(cursor, request.current.signal)}
            >
              Carregar mais
            </button>
          )
        )}
      </footer>
    </section>
  );
}
