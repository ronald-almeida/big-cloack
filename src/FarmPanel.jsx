import React, { useEffect, useState } from "react";
import { farmThemes, farmSlug } from "../shared/farm.mjs";
import "./farm.css";
const blank = () => ({
  data: {
    cnpj: "",
    razao: "",
    fantasia: "",
    abertura: "",
    atividade: "",
    cidade: "",
    uf: "",
    telefone: "",
    email: "",
  },
  theme: "id01",
  subdomain: "",
  domain_id: "",
  head: "",
});
const labels = {
  draft: "Rascunho",
  provisioning: "Aguardando HTTPS",
  published: "Publicado",
  error: "Erro",
};
const date = (v) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
export default function FarmPanel({ request }) {
  const [tab, setTab] = useState("Sites"),
    [sites, setSites] = useState([]),
    [domains, setDomains] = useState([]),
    [form, setForm] = useState(blank),
    [headSite, setHeadSite] = useState(null),
    [history, setHistory] = useState(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState(""),
    [manualSlug, setManualSlug] = useState(false),
    [query, setQuery] = useState("");
  const [domainForm, setDomainForm] = useState({
      hostname: "",
      site_limit: "",
    }),
    [limits, setLimits] = useState({});
  async function refresh() {
    const [s, d] = await Promise.all([
      request("farm/sites"),
      request("farm/domains"),
    ]);
    setSites(s);
    setDomains(d);
    setLimits(Object.fromEntries(d.map((x) => [x.id, x.site_limit ?? ""])));
  }
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function edit(site) {
    setForm(site ? { ...site, data: { ...site.data } } : blank());
    setManualSlug(!!site);
    setPreview("");
    setHeadSite(null);
    setTab("Criar Site");
    setError("");
    setNotice("");
  }
  function field(key, value) {
    setForm((old) => {
      const data = { ...old.data, [key]: value };
      return {
        ...old,
        data,
        subdomain: manualSlug
          ? old.subdomain
          : farmSlug(data.fantasia || data.razao),
      };
    });
    setPreview("");
  }
  async function save(e) {
    e.preventDefault();
    await run(async () => {
      let id = form.id;
      if (id) await request("farm/sites/" + id, "PUT", form);
      else {
        const created = await request("farm/sites", "POST", form);
        id = created.id;
        setForm((f) => ({ ...f, id }));
      }
      try {
        const result = await request(
          "farm/sites/" + id + "/publish",
          "POST",
          {},
        );
        setNotice(
          result.status === "published"
            ? "Site publicado."
            : "Site enviado à Cloudflare. Aguardando DNS e certificado HTTPS.",
        );
        setTab("Sites");
      } finally {
        await refresh();
      }
    });
  }
  async function publish(site) {
    await run(async () => {
      try {
        const r = await request(
          "farm/sites/" + site.id + "/publish",
          "POST",
          {},
        );
        setNotice(
          r.status === "published"
            ? "Site republicado."
            : "Publicação enviada. Use Verificar HTTPS para acompanhar.",
        );
      } finally {
        await refresh();
      }
    });
  }
  return (
    <section className="farm-module" aria-label="Farm BM">
      <div className="farm-tabs" aria-label="Áreas do Farm">
        {["Sites", "Criar Site", "Domínios Farm"].map((t) => (
          <button
            key={t}
            disabled={busy}
            aria-current={tab === t ? "page" : undefined}
            className={tab === t ? "primary" : ""}
            onClick={() =>
              t === "Criar Site"
                ? edit(null)
                : (setTab(t), setHeadSite(null), setHistory(null))
            }
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <p role="status">Carregando Farm BM…</p>
      ) : (
        <>
          {tab === "Sites" && (
            <>
              <div className="farm-heading">
                <div>
                  <h2>
                    Sites das empresas{" "}
                    <span className="count">{sites.length}</span>
                  </h2>
                  <p>Publique, atualize e acompanhe seus sites.</p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => edit(null)}
                >
                  Criar site
                </button>
              </div>
              <label className="farm-search">
                Buscar empresa ou CNPJ
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nome, CNPJ ou domínio"
                />
              </label>
              {headSite && (
                <form
                  className="farm-card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await request(
                        "farm/sites/" + headSite.id + "/head",
                        "PUT",
                        { head: headSite.head },
                      );
                      try {
                        await request(
                          "farm/sites/" + headSite.id + "/publish",
                          "POST",
                          {},
                        );
                        setNotice("HEAD salvo e publicação enviada.");
                        setHeadSite(null);
                      } finally {
                        await refresh();
                      }
                    });
                  }}
                >
                  <h3>HEAD — {headSite.company}</h3>
                  <p>
                    Adicione a verificação de domínio, tags e scripts deste
                    site. O código será publicado ao salvar.
                  </p>
                  <label>
                    Código personalizado
                    <textarea
                      rows={10}
                      maxLength={32000}
                      value={headSite.head}
                      onChange={(e) =>
                        setHeadSite({ ...headSite, head: e.target.value })
                      }
                      spellCheck={false}
                    />
                  </label>
                  <div className="farm-actions">
                    <button className="primary" disabled={busy}>
                      Salvar e republicar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setHeadSite(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
              {history && (
                <div className="farm-card">
                  <div className="farm-heading">
                    <h3>Histórico — {history.company}</h3>
                    <button onClick={() => setHistory(null)}>
                      Fechar histórico
                    </button>
                  </div>
                  {history.rows.length ? (
                    history.rows.map((r) => (
                      <p key={r.id}>
                        {date(r.created_at)} ·{" "}
                        {r.action === "delete" ? "Exclusão" : "Publicação"} ·{" "}
                        {labels[r.status] || r.status} · {r.message}
                      </p>
                    ))
                  ) : (
                    <p>Nenhuma publicação ainda.</p>
                  )}
                </div>
              )}
              <div className="farm-table">
                <table>
                  <thead>
                    <tr>
                      <th>Empresa / CNPJ</th>
                      <th>Endereço</th>
                      <th>Tema / Status</th>
                      <th>Datas</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites
                      .filter((s) =>
                        (s.company + s.cnpj + s.hostname)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((s) => (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.company}</strong>
                            <small>{s.cnpj}</small>
                            {s.last_error && (
                              <small className="farm-error">
                                {s.last_error}
                              </small>
                            )}
                          </td>
                          <td>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {s.subdomain}.{s.hostname}
                            </a>
                            <small>Domínio: {s.hostname}</small>
                          </td>
                          <td>
                            {farmThemes.find((t) => t.id === s.theme)?.name}
                            <small>{labels[s.status]}</small>
                            {s.published_version &&
                            s.version !== s.published_version ? (
                              <small>Alterações não publicadas</small>
                            ) : null}
                          </td>
                          <td>
                            <small>Criado: {date(s.created_at)}</small>
                            <small>Editado: {date(s.updated_at)}</small>
                            <small>Publicado: {date(s.published_at)}</small>
                          </td>
                          <td>
                            <div className="farm-actions">
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Abrir
                              </a>
                              <button disabled={busy} onClick={() => edit(s)}>
                                Editar
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  setHeadSite({
                                    id: s.id,
                                    company: s.company,
                                    head: s.head,
                                  })
                                }
                              >
                                HEAD
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => publish(s)}
                              >
                                Republicar
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    const r = await request(
                                      "farm/sites/" + s.id + "/verify",
                                      "POST",
                                      {},
                                    );
                                    await refresh();
                                    setNotice(
                                      r.status === "published"
                                        ? "HTTPS confirmado."
                                        : "O site ainda não está respondendo por HTTPS.",
                                    );
                                  })
                                }
                              >
                                Verificar HTTPS
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () =>
                                    setHistory({
                                      company: s.company,
                                      rows: await request(
                                        "farm/sites/" + s.id + "/history",
                                      ),
                                    }),
                                  )
                                }
                              >
                                Histórico
                              </button>
                              <button
                                className="farm-danger"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Excluir o site " +
                                        s.company +
                                        " e remover seu endereço da Cloudflare?",
                                    )
                                  )
                                    run(async () => {
                                      await request(
                                        "farm/sites/" + s.id,
                                        "DELETE",
                                      );
                                      await refresh();
                                      setNotice("Site excluído.");
                                    });
                                }}
                              >
                                Excluir
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!sites.length && (
                  <div className="farm-empty">
                    <h3>Seu primeiro site começa aqui</h3>
                    <p>
                      Cadastre um domínio Farm e crie o site de uma empresa pelo
                      CNPJ.
                    </p>
                    <button onClick={() => setTab("Domínios Farm")}>
                      Cadastrar domínio
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {tab === "Criar Site" && (
            <form onSubmit={save} className="farm-card">
              <h2>{form.id ? "Editar site" : "Criar site"}</h2>
              <p>
                Consulte o CNPJ, revise os dados e escolha o endereço. Todos os
                campos da empresa podem ser preenchidos manualmente.
              </p>
              <fieldset disabled={busy}>
                <div className="farm-cnpj">
                  <label>
                    CNPJ
                    <input
                      required
                      value={form.data.cnpj}
                      onChange={(e) => field("cnpj", e.target.value)}
                      placeholder="00.000.000/0000-00"
                      maxLength={18}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      run(async () => {
                        const result = await request(
                          "farm/cnpj?cnpj=" +
                            encodeURIComponent(form.data.cnpj),
                        );
                        setForm((f) => ({
                          ...f,
                          data: result.data,
                          subdomain: manualSlug
                            ? f.subdomain
                            : farmSlug(
                                result.data.fantasia || result.data.razao,
                              ),
                        }));
                        setPreview("");
                        setNotice(
                          "Dados encontrados na BrasilAPI. Revise antes de publicar.",
                        );
                      })
                    }
                  >
                    Buscar CNPJ
                  </button>
                </div>
                <div className="farm-grid">
                  {[
                    ["razao", "Razão social"],
                    ["fantasia", "Nome fantasia"],
                    ["abertura", "Data de abertura"],
                    ["atividade", "Atividade principal"],
                    ["cidade", "Cidade"],
                    ["uf", "UF"],
                    ["telefone", "Telefone / WhatsApp com DDD"],
                    ["email", "E-mail"],
                  ].map(([k, l]) => (
                    <label key={k}>
                      {l}
                      <input
                        type={k === "email" ? "email" : "text"}
                        required={k === "razao"}
                        value={form.data[k]}
                        onChange={(e) => field(k, e.target.value)}
                        maxLength={
                          k === "uf" ? 2 : k === "atividade" ? 500 : 200
                        }
                      />
                    </label>
                  ))}
                </div>
                <h3>Estilo visual</h3>
                <div className="farm-themes">
                  {farmThemes.map((t, i) => (
                    <label
                      key={t.id}
                      className={form.theme === t.id ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="farm-theme"
                        value={t.id}
                        checked={form.theme === t.id}
                        onChange={() => {
                          setForm({ ...form, theme: t.id });
                          setPreview("");
                        }}
                      />
                      <span>
                        {String(i + 1).padStart(2, "0")} · {t.name}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="farm-grid">
                  <label>
                    Distribuição
                    <select
                      value={form.domain_id}
                      onChange={(e) =>
                        setForm({ ...form, domain_id: e.target.value })
                      }
                    >
                      <option value="">
                        Automática — domínio com menos sites
                      </option>
                      {domains.map((d) => (
                        <option
                          key={d.id}
                          value={d.id}
                          disabled={
                            !d.active ||
                            (d.id !== form.domain_id &&
                              d.site_limit !== null &&
                              d.site_count >= d.site_limit)
                          }
                        >
                          {d.hostname} · {d.site_count}/
                          {d.site_limit ?? "sem limite"}
                          {!d.active ? " · inativo" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Subdomínio
                    <input
                      required
                      maxLength={63}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      value={form.subdomain}
                      onChange={(e) => {
                        setManualSlug(true);
                        setForm({
                          ...form,
                          subdomain: e.target.value.toLowerCase(),
                        });
                      }}
                    />
                  </label>
                </div>
                <p className="farm-address">
                  https://{form.subdomain || "empresa"}.
                  {domains.find((d) => d.id === form.domain_id)?.hostname ||
                    "domínio escolhido automaticamente"}
                </p>
                {form.id && (
                  <p>
                    Ao mudar o endereço de um site publicado, o endereço
                    anterior será removido e o novo aguardará a ativação do
                    HTTPS.
                  </p>
                )}
                <div className="farm-actions">
                  <button className="primary">
                    {busy
                      ? "Publicando…"
                      : form.id
                        ? "Salvar e republicar"
                        : "Publicar site"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      run(async () => {
                        const p = await request("farm/preview", "POST", form);
                        setPreview(p.html);
                      })
                    }
                  >
                    Pré-visualizar estilo
                  </button>
                  <button type="button" onClick={() => setTab("Sites")}>
                    Cancelar
                  </button>
                </div>
              </fieldset>
              {preview && (
                <iframe
                  className="farm-preview"
                  title="Prévia do site da empresa"
                  srcDoc={preview}
                  sandbox="allow-scripts"
                />
              )}
            </form>
          )}
          {tab === "Domínios Farm" && (
            <>
              <div className="farm-heading">
                <div>
                  <h2>Domínios Farm</h2>
                  <p>
                    Capacidade e publicação independentes dos domínios do Cloak.
                  </p>
                </div>
              </div>
              <form
                className="farm-card farm-domain-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const d = await request("farm/domains", "POST", domainForm);
                    setDomainForm({ hostname: "", site_limit: "" });
                    await refresh();
                    setNotice(
                      d.last_error
                        ? "Domínio salvo. " + d.last_error
                        : d.active
                          ? "Domínio conectado e ativo."
                          : "Domínio cadastrado. Confira os nameservers abaixo.",
                    );
                  });
                }}
              >
                <label>
                  Domínio raiz
                  <input
                    placeholder="empresa.com.br"
                    required
                    disabled={busy}
                    value={domainForm.hostname}
                    onChange={(e) =>
                      setDomainForm({ ...domainForm, hostname: e.target.value })
                    }
                  />
                </label>
                <label>
                  Limite de sites (opcional)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Sem limite"
                    disabled={busy}
                    value={domainForm.site_limit}
                    onChange={(e) =>
                      setDomainForm({
                        ...domainForm,
                        site_limit: e.target.value,
                      })
                    }
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Adicionar domínio
                </button>
              </form>
              <p>
                Se o domínio ainda não usa a Cloudflare, atualize os nameservers
                no registrador após cadastrá-lo. O painel mostra quais usar.
              </p>
              {domains.map((d) => (
                <div className="farm-card" key={d.id}>
                  <div className="farm-heading">
                    <div>
                      <h3>{d.hostname}</h3>
                      <p>
                        {d.active ? "Ativo" : "Inativo"} · {d.site_count}/
                        {d.site_limit ?? "sem limite"} sites · Cloudflare:{" "}
                        {d.zone_status}
                      </p>
                    </div>
                    <div className="farm-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await request("farm/domains/" + d.id, "PUT", {
                              active: !d.active,
                            });
                            await refresh();
                          })
                        }
                      >
                        {d.active ? "Desativar" : "Ativar / verificar"}
                      </button>
                      <button
                        className="farm-danger"
                        disabled={busy || d.site_count > 0}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Remover " +
                                d.hostname +
                                " do Farm? A zona Cloudflare será preservada.",
                            )
                          )
                            run(async () => {
                              await request("farm/domains/" + d.id, "DELETE");
                              await refresh();
                            });
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                  {d.last_error && <p className="farm-error">{d.last_error}</p>}
                  {d.zone_status !== "active" && d.nameservers.length > 0 && (
                    <p>Nameservers: {d.nameservers.join(" · ")}</p>
                  )}
                  <div className="farm-actions">
                    <label>
                      Limite de sites
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Sem limite"
                        value={limits[d.id] ?? ""}
                        onChange={(e) =>
                          setLimits({ ...limits, [d.id]: e.target.value })
                        }
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await request("farm/domains/" + d.id, "PUT", {
                            site_limit: limits[d.id],
                          });
                          await refresh();
                          setNotice("Limite atualizado.");
                        })
                      }
                    >
                      Salvar limite
                    </button>
                  </div>
                  <small>
                    Desativar suspende os sites deste domínio. O limite
                    considera todos os sites cadastrados, inclusive rascunhos e
                    publicações pendentes.
                  </small>
                </div>
              ))}
              {!domains.length && <p>Nenhum domínio Farm cadastrado.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
