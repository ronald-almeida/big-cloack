import DomainsPanel from "./DomainsPanel.jsx";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Link,
  Globe,
  BarChart3,
  Plus,
  ArrowUpRight,
  Copy,
  QrCode,
  Pencil,
  Trash2,
  X,
  Check,
  Search,
  Shield,
  ChevronRight,
} from "lucide-react";
import QRCode from "qrcode";
import WaitingEditor from "./WaitingEditor.jsx";
import AccessLogs from "./AccessLogs.jsx";
import "./style.css";
const empty = {
  name: "",
  slug: "",
  mode: "waiting",
  device: "all",
  real_urls: [],
  waiting_url: "",
  waiting_page: { theme: "sky" },
};
async function api(path, method = "GET", body) {
  const response = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "Sua sessão expirou. Atualize a página para entrar novamente.",
    );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
function App() {
  const [page, setPage] = useState("Visão geral"),
    [links, setLinks] = useState([]),
    [domains, setDomains] = useState([]),
    [analytics, setAnalytics] = useState(null),
    [days, setDays] = useState(30),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState(""),
    [editor, setEditor] = useState(null),
    [urls, setUrls] = useState(""),
    [selectedDomain, setSelectedDomain] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState(null),
    [confirm, setConfirm] = useState(null);
  const activeDomains = domains.filter((d) => d.verified);
  const modalOpen = Boolean(editor || qr || confirm);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement;
    const modal = document.querySelector('[role="dialog"]');
    const background = document.querySelectorAll("aside, main");
    background.forEach((element) => {
      element.inert = true;
    });
    const focusable = () => [
      ...modal.querySelectorAll(
        "button:not(:disabled),input,select,textarea,a[href]",
      ),
    ];
    focusable()[0]?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        setEditor(null);
        setQr(null);
        setConfirm(null);
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      background.forEach((element) => {
        element.inert = false;
      });
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [modalOpen]);
  async function refresh() {
    setLoading(true);
    try {
      const [l, d, a] = await Promise.all([
        api("links"),
        api("domains"),
        api(`analytics?days=${days}&link=${filter}`),
      ]);
      setLinks(l);
      setDomains(d);
      setAnalytics(a);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [days, filter]);
  useEffect(() => {
    if (!activeDomains.some((d) => d.hostname === selectedDomain))
      setSelectedDomain(activeDomains[0]?.hostname || "");
  }, [domains]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function edit(l = empty) {
    setEditor({ ...l });
    setUrls(l.real_urls.join("\n"));
    setError("");
  }
  function linkUrl(l) {
    return `https://${selectedDomain}/${l.slug}`;
  }
  async function copy(l) {
    try {
      await navigator.clipboard.writeText(linkUrl(l));
      setNotice("Link copiado.");
    } catch {
      setError(
        "Não foi possível copiar. Selecione e copie o endereço na janela de QR Code.",
      );
    }
  }
  async function showQR(l) {
    try {
      setQr({
        name: l.name,
        url: linkUrl(l),
        image: await QRCode.toDataURL(linkUrl(l), { width: 320, margin: 2 }),
      });
    } catch {
      setError("Não foi possível gerar o QR Code.");
    }
  }
  const summary = analytics?.summary || {
    total: 0,
    real: 0,
    waiting: 0,
    mobile: 0,
  };
  const nav = [
    ["Visão geral", LayoutDashboard],
    ["Links", Link],
    ["Analytics", BarChart3],
    ["Acessos", Search],
    ["Domínios", Globe],
  ];
  const filtered = links.filter((l) =>
    (l.name + " " + l.slug).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <span className="brand-icon">
            <Link size={22} />
          </span>
          big cloak<span className="brand-dot">.</span>
        </div>
        <div className="workspace">
          <span className="avatar">R</span>
          <div>
            Meu workspace<small>Administrador</small>
          </div>
          <ChevronRight size={16} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              onClick={() => {
                setPage(name);
                setFilter("");
              }}
            >
              <Icon size={19} />
              {name}
              {name === "Links" && (
                <span className="nav-count">{links.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <Shield size={20} />
          <div>
            Acesso protegido<small>Cloudflare Access</small>
          </div>
        </div>
        <div className="profile">
          <span className="avatar small">RA</span>
          <div>
            Ronald Almeida<small>Administrador</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} /> <b>{page}</b>
          </div>
          <span className="platform">
            <span />
            Cloudflare nativo
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">SEU CONTROLE, EM UM SÓ LUGAR</p>
              <h1>{page}</h1>
              <p>
                {page === "Acessos"
                  ? "Veja quando cada link foi aberto e qual destino foi aplicado."
                  : page === "Domínios"
                    ? "Conecte seus domínios e compartilhe links com sua marca."
                    : page === "Analytics"
                      ? "Entenda de onde vêm os acessos e para onde eles vão."
                      : "Gerencie destinos. Acompanhe cada acesso."}
              </p>
            </div>
            {!["Domínios", "Acessos"].includes(page) && (
              <button className="primary" onClick={() => edit()}>
                <Plus size={18} />
                Criar link
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button aria-label="Fechar erro" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {!["Domínios", "Acessos"].includes(page) && (
            <>
              <div className="period">
                <span>
                  {page === "Links"
                    ? "Contadores gerais"
                    : "Resumo de desempenho"}
                </span>
                <select
                  aria-label="Período"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={7}>Últimos 7 dias</option>
                  <option value={30}>Últimos 30 dias</option>
                  <option value={90}>Últimos 90 dias</option>
                </select>
              </div>
              <div className="stats">
                {[
                  [
                    "Total de acessos",
                    summary.total,
                    BarChart3,
                    "No período selecionado",
                  ],
                  [
                    "Destino Real",
                    summary.real,
                    ArrowUpRight,
                    "Acessos direcionados ao Real",
                  ],
                  [
                    "Em Espera",
                    summary.waiting,
                    Link,
                    "Acessos ao destino de espera",
                  ],
                  [
                    "Links cadastrados",
                    links.length,
                    Globe,
                    `${links.filter((l) => l.mode === "real").length} em modo Real`,
                  ],
                ].map(([label, value, Icon, sub]) => (
                  <div className="stat" key={label}>
                    <div>
                      {label}
                      <span>
                        <Icon size={18} />
                      </span>
                    </div>
                    <strong>{Number(value).toLocaleString("pt-BR")}</strong>
                    <small>{sub}</small>
                  </div>
                ))}
              </div>
            </>
          )}
          {(page === "Visão geral" || page === "Analytics") && (
            <section className="chart-card">
              <div className="section-heading">
                <div>
                  <h2>Acessos ao longo do tempo</h2>
                  <p>Volume diário • horário UTC</p>
                </div>
                {page === "Analytics" && (
                  <select
                    aria-label="Filtrar por link"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">Todos os links</option>
                    {links.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="legend">
                  <i />
                  Acessos
                </span>
              </div>
              <div className="chart">
                {summary.total ? (
                  Array.from({ length: days }, (_, i) => {
                    const date = new Date(
                        Date.now() - (days - 1 - i) * 86400000,
                      )
                        .toISOString()
                        .slice(0, 10),
                      count =
                        analytics.daily.find((d) => d.day === date)?.total || 0,
                      max = Math.max(1, ...analytics.daily.map((d) => d.total));
                    return (
                      <div
                        className="bar-column"
                        key={date}
                        title={`${date}: ${count} acessos`}
                      >
                        <div
                          className="bar"
                          style={{ height: Math.max(2, (count / max) * 140) }}
                        />
                        <small>
                          {i % Math.ceil(days / 7) === 0
                            ? date.slice(5).replace("-", "/")
                            : ""}
                        </small>
                      </div>
                    );
                  })
                ) : (
                  <div className="chart-empty">
                    <BarChart3 size={28} />
                    <b>Seus primeiros acessos aparecerão aqui</b>
                    <span>
                      Crie um link e compartilhe para acompanhar os resultados.
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
          {(page === "Visão geral" || page === "Links") && (
            <section className="table-card">
              <div className="section-heading">
                <div>
                  <h2>
                    {page === "Links" ? "Seus links" : "Links recentes"}{" "}
                    <span className="count">{links.length}</span>
                  </h2>
                  <p>Destinos e regras sob seu controle.</p>
                </div>
                <div className="table-tools">
                  <label className="search">
                    <Search size={17} />
                    <input
                      placeholder="Buscar links..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Domínio para copiar links"
                    value={selectedDomain}
                    onChange={(e) => setSelectedDomain(e.target.value)}
                  >
                    {!activeDomains.length && (
                      <option value="">Sem domínio ativo</option>
                    )}
                    {activeDomains.map((d) => (
                      <option key={d.id}>{d.hostname}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>LINK / DESTINO</th>
                      <th>MODO</th>
                      <th>DISPOSITIVO REAL</th>
                      <th>ACESSOS TOTAIS</th>
                      <th>AÇÕES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered
                      .slice(0, page === "Visão geral" ? 5 : 1000)
                      .map((l) => (
                        <tr key={l.id}>
                          <td>
                            <b>{l.name}</b>
                            <small>/{l.slug}</small>
                          </td>
                          <td>
                            <span className={`badge ${l.mode}`}>
                              <i />
                              {l.mode === "real" ? "Real" : "Espera"}
                            </span>
                          </td>
                          <td>
                            {
                              {
                                all: "Todos",
                                mobile: "Mobile",
                                desktop: "Desktop",
                              }[l.device]
                            }
                          </td>
                          <td className="number">
                            {l.clicks.toLocaleString("pt-BR")}
                          </td>
                          <td>
                            <div className="actions">
                              <button
                                title="Copiar link"
                                aria-label={`Copiar ${l.name}`}
                                disabled={!selectedDomain}
                                onClick={() => copy(l)}
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                title="QR Code"
                                aria-label={`QR Code ${l.name}`}
                                disabled={!selectedDomain}
                                onClick={() => showQR(l)}
                              >
                                <QrCode size={16} />
                              </button>
                              <button
                                title="Editar"
                                aria-label={`Editar ${l.name}`}
                                onClick={() => edit(l)}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                title="Excluir"
                                aria-label={`Excluir ${l.name}`}
                                onClick={() =>
                                  setConfirm({
                                    type: "links",
                                    id: l.id,
                                    name: l.name,
                                  })
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!filtered.length && (
                <div className="empty">
                  <span className="empty-icon">
                    <Link size={25} />
                  </span>
                  <h3>
                    {loading
                      ? "Carregando seus links..."
                      : search
                        ? "Nenhum link encontrado"
                        : "Tudo começa com seu primeiro link"}
                  </h3>
                  <p>
                    Escolha os destinos, defina as regras e comece a
                    compartilhar.
                  </p>
                  {!search && (
                    <button onClick={() => edit()} className="secondary">
                      <Plus size={16} />
                      Criar primeiro link
                    </button>
                  )}
                </div>
              )}
              <footer>
                {links.length} links cadastrados{" "}
                <span>Regras explícitas por modo e dispositivo</span>
              </footer>
            </section>
          )}
          {page === "Analytics" && (
            <div className="analytics-grid">
              <section className="table-card">
                <div className="section-heading">
                  <h2>Dispositivos</h2>
                </div>
                {[
                  ["Mobile", summary.mobile],
                  ["Desktop", summary.total - summary.mobile],
                ].map(([name, count]) => (
                  <div className="metric-row" key={name}>
                    <span>{name}</span>
                    <b>{count}</b>
                    <progress value={count} max={summary.total || 1} />
                  </div>
                ))}
              </section>
              <section className="table-card">
                <div className="section-heading">
                  <h2>Países</h2>
                </div>
                {analytics?.countries.length ? (
                  analytics.countries.map((c) => (
                    <div className="metric-row" key={c.country}>
                      <span>
                        {c.country === "XX" ? "Não identificado" : c.country}
                      </span>
                      <b>{c.total}</b>
                    </div>
                  ))
                ) : (
                  <p className="muted padded">Ainda não há dados no período.</p>
                )}
              </section>
              <section className="table-card">
                <div className="section-heading">
                  <h2>Domínios</h2>
                </div>
                {analytics?.domains.length ? (
                  analytics.domains.map((d) => (
                    <div className="metric-row" key={d.hostname}>
                      <span>{d.hostname}</span>
                      <b>{d.total}</b>
                    </div>
                  ))
                ) : (
                  <p className="muted padded">Ainda não há dados no período.</p>
                )}
              </section>
            </div>
          )}
          {page === "Acessos" && <AccessLogs links={links} />}
          {page === "Domínios" && (
            <DomainsPanel
              domains={domains}
              request={api}
              refresh={refresh}
              onDelete={(d) =>
                setConfirm({ type: "domains", id: d.id, name: d.hostname })
              }
            />
          )}
          <div className="page-foot">
            Big Cloak <span>Workers · D1 · KV · Pages</span>
          </div>
        </div>
      </main>
      {editor && (
        <div className="overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
            className="modal link-editor"
          >
            <div className="modal-head">
              <div>
                <h2 id="edit-title">
                  {editor.id ? "Editar link" : "Criar novo link"}
                </h2>
                <p>Configure o destino de cada acesso.</p>
              </div>
              <button aria-label="Fechar" onClick={() => setEditor(null)}>
                <X />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await api(
                    "links" + (editor.id ? "/" + editor.id : ""),
                    editor.id ? "PUT" : "POST",
                    {
                      ...editor,
                      real_urls: urls
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  );
                  setEditor(null);
                  setNotice("Link salvo.");
                });
              }}
            >
              <label>
                Nome do link
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={editor.name}
                  onChange={(e) =>
                    setEditor({ ...editor, name: e.target.value })
                  }
                  placeholder="Ex.: Campanha de lançamento"
                />
              </label>
              <label>
                Slug <span>Opcional · gerado automaticamente se vazio</span>
                <input
                  value={editor.slug}
                  onChange={(e) =>
                    setEditor({ ...editor, slug: e.target.value })
                  }
                  placeholder="minha-campanha"
                />
              </label>
              <div className="form-grid">
                <label>
                  Modo
                  <select
                    value={editor.mode}
                    onChange={(e) =>
                      setEditor({ ...editor, mode: e.target.value })
                    }
                  >
                    <option value="waiting">Espera</option>
                    <option value="real">Real</option>
                  </select>
                </label>
                <label>
                  Dispositivo para o Real
                  <select
                    value={editor.device}
                    onChange={(e) =>
                      setEditor({ ...editor, device: e.target.value })
                    }
                  >
                    <option value="all">Todos</option>
                    <option value="mobile">Mobile (inclui tablets)</option>
                    <option value="desktop">Desktop</option>
                  </select>
                </label>
              </div>
              <div className="rule-info">
                {editor.mode === "waiting"
                  ? "Todos os dispositivos vão para Espera."
                  : editor.device === "all"
                    ? "Todos os dispositivos vão para Real."
                    : `Somente ${editor.device} vai para Real. Os demais vão para Espera.`}
              </div>
              <label>
                URLs reais{" "}
                <span>Uma por linha · distribuição aleatória uniforme</span>
                <textarea
                  rows={4}
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                  placeholder={
                    "https://seusite.com/oferta-1\nhttps://seusite.com/oferta-2"
                  }
                />
              </label>
              <label>
                URL de espera{" "}
                <span>Opcional · página institucional abaixo se vazio</span>
                <input
                  type="url"
                  value={editor.waiting_url}
                  onChange={(e) =>
                    setEditor({ ...editor, waiting_url: e.target.value })
                  }
                  placeholder="https://seusite.com/em-breve"
                />
              </label>
              <WaitingEditor
                value={editor.waiting_page}
                name={editor.name}
                external={Boolean(editor.waiting_url)}
                onChange={(page) =>
                  setEditor({ ...editor, waiting_page: page })
                }
              />
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditor(null)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Salvando..." : "Salvar link"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {qr && (
        <div className="overlay">
          <section
            className="modal qr-modal"
            role="dialog"
            aria-modal="true"
            aria-label="QR Code"
          >
            <button
              className="close"
              aria-label="Fechar QR Code"
              onClick={() => setQr(null)}
            >
              <X />
            </button>
            <h2>{qr.name}</h2>
            <img src={qr.image} alt={`QR Code para ${qr.url}`} />
            <p className="qr-url">{qr.url}</p>
            <a className="primary" href={qr.image} download="qrcode.png">
              Baixar QR Code
            </a>
          </section>
        </div>
      )}
      {confirm && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar exclusão"
          >
            <h2>Excluir {confirm.name}?</h2>
            <p>
              {confirm.type === "links"
                ? "O link e seu histórico de acessos serão excluídos."
                : "Os redirects neste domínio deixarão de funcionar. A configuração na Cloudflare não será removida."}
            </p>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api(`${confirm.type}/${confirm.id}`, "DELETE");
                    setConfirm(null);
                    setNotice("Excluído.");
                  })
                }
              >
                Excluir
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
