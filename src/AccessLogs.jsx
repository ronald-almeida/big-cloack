import useLiveQuery, { getJSON } from "./useLiveQuery.js";
import LiveStatus from "./LiveStatus.jsx";
import TrafficFilters from "./TrafficFilters.jsx";
import { TRAFFIC_CLASSES, BOT_PROVIDERS } from "../shared/traffic.mjs";
import React, { useRef, useState } from "react";
import { RefreshCw, Smartphone, Monitor, Clock3 } from "lucide-react";
export default function AccessLogs({
  links,
  domains = [],
  rangeQuery = "",
  hostname = "",
  linkFilter = "",
  trafficFilters = {},
}) {
  const [filters, setFilters] = useState({
    link: "",
    device: "",
    destination: "",
    hostname: "",
  });
  const more = useRef(null);
  const query = new URLSearchParams(rangeQuery);
  for (const [key, value] of Object.entries({ ...filters, ...trafficFilters }))
    if (value) query.set(key, value);
  if (hostname) query.set("hostname", hostname);
  if (linkFilter) query.set("link", linkFilter);
  const queryKey = query.toString();
  const live = useLiveQuery(
    queryKey,
    async (signal, previous) => {
      const page = (cursor) =>
        getJSON(
          "/api/logs?" + queryKey + (cursor ? "&cursor=" + cursor : ""),
          signal,
        );
      if (more.current === queryKey && previous?.next_cursor) {
        more.current = null;
        const next = await page(previous.next_cursor);
        return { ...next, items: [...previous.items, ...next.items] };
      }
      more.current = null;
      let latest = await page(null);
      const fresh = [...latest.items];
      // Catch every intervening page after a burst or a background tab, then
      // keep older pages the user already opened and their pagination cursor.
      const newest = previous?.items[0]?.id;
      while (newest && latest.next_cursor && latest.items.at(-1).id > newest) {
        latest = await page(latest.next_cursor);
        fresh.push(...latest.items);
      }
      if (!newest) return latest;
      const merged = new Map(
        [...(previous?.items || []), ...fresh].map((item) => [item.id, item]),
      );
      const oldestPrevious = previous.items.at(-1).id;
      const reachedOlder = fresh.at(-1)?.id <= oldestPrevious;
      return {
        items: [...merged.values()].sort((a, b) => b.id - a.id),
        next_cursor: reachedOlder ? latest.next_cursor : previous.next_cursor,
      };
    },
    Boolean(rangeQuery),
  );
  const items = live.data?.items || [],
    cursor = live.data?.next_cursor,
    loading = live.loading || live.status === "updating",
    error = live.error;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const format = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: timezone,
  });
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
        <button className="secondary" disabled={loading} onClick={live.refresh}>
          <RefreshCw size={15} />
          Atualizar
        </button>
      </div>
      {rangeQuery && <LiveStatus {...live} />}
      <div className="logs-filters">
        {!Object.keys(trafficFilters).length && (
          <TrafficFilters filters={filters} onChange={change} />
        )}
        {!linkFilter && (
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
        )}
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
        Horário local: {timezone}. Requisições GET e HEAD (incluindo previews);
        não representam visitantes únicos.
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
              <th>TRÁFEGO / EVIDÊNCIAS</th>
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
                <td className="traffic-detail">
                  <b>
                    {TRAFFIC_CLASSES[item.classification] || "Indeterminado"}
                  </b>
                  <small>
                    {BOT_PROVIDERS[item.bot_provider]} · {item.request_method}
                  </small>
                  <details>
                    <summary>
                      Confiança de automação:{" "}
                      {item.bot_confidence == null
                        ? "não disponível"
                        : `${item.bot_confidence}/100`}
                    </summary>
                    <p>
                      Índice heurístico, não uma probabilidade. Provider
                      provável.
                    </p>
                    <ul>
                      {(item.bot_reason || []).map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                    {!item.classifier_version && (
                      <p>Registro anterior à classificação.</p>
                    )}
                    <dl>
                      {Object.entries({
                        "User-Agent": item.user_agent,
                        IP: item.ip,
                        ASN: item.asn,
                        Referer: item.referer,
                        "CF-Ray": item.cf_ray,
                      }).map(([label, value]) => (
                        <React.Fragment key={label}>
                          <dt>{label}</dt>
                          <dd>{value ?? "Não disponível"}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                    <details>
                      <summary>
                        Sinais coletados (v{item.classifier_version ?? "—"})
                      </summary>
                      <pre>{JSON.stringify(item.traffic_signals, null, 2)}</pre>
                    </details>
                  </details>
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
              onClick={() => {
                more.current = queryKey;
                live.refresh();
              }}
            >
              Carregar mais
            </button>
          )
        )}
      </footer>
    </section>
  );
}
