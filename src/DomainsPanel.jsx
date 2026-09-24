import React, { useEffect, useRef, useState } from "react";
import {
  Globe,
  Plus,
  PlugZap,
  Trash2,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
const statuses = {
  pending: "Não conectado",
  needs_zone: "Adicionar à Cloudflare",
  nameservers: "Aguardando nameservers",
  provisioning: "Ativando HTTPS",
  active: "Ativo",
  error: "Requer atenção",
};
export default function DomainsPanel({ domains, request, refresh, onDelete }) {
  const [hostname, setHostname] = useState(""),
    [configured, setConfigured] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [roots, setRoots] = useState({});
  const polling = useRef(false);
  useEffect(() => {
    let live = true;
    request("integrations/cloudflare")
      .then((r) => {
        if (live) setConfigured(r.configured);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      if (result?.message) setMessage(result.message);
    } catch (e) {
      setError(e.message);
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    const timer = setInterval(async () => {
      if (polling.current || busy || !configured) return;
      const pending = domains.filter((d) =>
        ["provisioning", "nameservers"].includes(d.connection_status),
      );
      if (!pending.length) return;
      polling.current = true;
      try {
        for (const d of pending) {
          if (!live) break;
          await request(
            `domains/${d.id}/${d.connection_status === "nameservers" ? "connect" : "verify"}`,
            "POST",
            {},
          );
        }
        if (live) await refresh();
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        polling.current = false;
      }
    }, 20000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [domains, busy, configured]);
  return (
    <>
      <div className={"integration-card " + (configured ? "ready" : "")}>
        <PlugZap size={22} />
        <div>
          <b>
            {configured === null
              ? "Verificando integração..."
              : configured
                ? "Integração configurada"
                : "Integração Cloudflare pendente"}
          </b>
          <p>
            {configured
              ? "O painel configura o domínio, o DNS do redirector e acompanha a ativação do HTTPS."
              : "A credencial Cloudflare precisa ser configurada uma única vez no servidor. Depois disso, os domínios são conectados por aqui."}
          </p>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="domain-message" role="status">
          {message}
        </p>
      )}
      <section className="domain-add">
        <div className="empty-icon">
          <Globe size={24} />
        </div>
        <div>
          <h2>Conectar domínio de redirect</h2>
          <p>Informe o endereço que você quer usar nos seus links.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const d = await request("domains", "POST", { hostname });
                setHostname("");
                return request(`domains/${d.id}/connect`, "POST", {});
              });
            }}
          >
            <input
              aria-label="Novo domínio"
              placeholder="links.seudominio.com"
              required
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
            <button className="primary" disabled={busy}>
              <Plus size={17} />
              {busy ? "Conectando..." : "Adicionar e conectar"}
            </button>
          </form>
        </div>
      </section>
      <section className="table-card">
        <div className="section-heading">
          <h2>
            Seus domínios <span className="count">{domains.length}</span>
          </h2>
          <small>Atualização automática durante a conexão</small>
        </div>
        {!domains.length && (
          <div className="empty">
            <Globe size={28} />
            <h3>Nenhum domínio cadastrado</h3>
            <p>Adicione o endereço acima para começar.</p>
          </div>
        )}
        {domains.map((d) => {
          let nameservers = [];
          try {
            nameservers = JSON.parse(d.nameservers || "[]");
          } catch {}
          return (
            <article className="domain-connection" key={d.id}>
              <div className="domain-row">
                <Globe size={22} />
                <div>
                  <b>{d.hostname}</b>
                  <small>
                    {d.verified
                      ? "Pronto para compartilhar"
                      : d.connection_message ||
                        "Clique em Conectar para iniciar."}
                  </small>
                </div>
                <span className={"badge " + (d.verified ? "real" : "waiting")}>
                  {d.verified
                    ? "Ativo"
                    : statuses[d.connection_status] || "Pendente"}
                </span>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      request(
                        `domains/${d.id}/${d.verified || d.connection_status === "provisioning" ? "verify" : "connect"}`,
                        "POST",
                        {},
                      ),
                    )
                  }
                >
                  {d.verified ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <RefreshCw size={15} />
                  )}{" "}
                  {d.verified || d.connection_status === "provisioning"
                    ? "Verificar conexão"
                    : d.connection_status === "nameservers"
                      ? "Continuar conexão"
                      : "Conectar"}
                </button>
                <button
                  aria-label={`Excluir domínio ${d.hostname}`}
                  disabled={busy}
                  onClick={() => onDelete(d)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
              {d.connection_status === "needs_zone" && (
                <form
                  className="zone-create"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() =>
                      request(`domains/${d.id}/connect`, "POST", {
                        zone_name: roots[d.id],
                      }),
                    );
                  }}
                >
                  <label>
                    Domínio raiz comprado no registrador
                    <input
                      required
                      placeholder="seudominio.com"
                      value={roots[d.id] || ""}
                      onChange={(e) =>
                        setRoots({ ...roots, [d.id]: e.target.value })
                      }
                    />
                  </label>
                  <button className="secondary" disabled={busy}>
                    Adicionar à Cloudflare
                  </button>
                  <p>
                    Use o domínio raiz, mesmo que seus links usem um subdomínio.
                    Nenhum domínio é comprado por este painel.
                  </p>
                </form>
              )}
              {d.connection_status === "nameservers" && (
                <div className="nameservers">
                  <b>Uma etapa no registrador do domínio</b>
                  <p>
                    Substitua os nameservers atuais pelos endereços abaixo.
                    Antes da troca, mantenha na Cloudflare os registros
                    existentes de site e e-mail.
                  </p>
                  <ul>
                    {nameservers.map((ns) => (
                      <li key={ns}>
                        <code>{ns}</code>
                      </li>
                    ))}
                  </ul>
                  <p>
                    O painel continuará a conexão quando a Cloudflare confirmar
                    a alteração. Mantenha esta tela aberta ou clique em
                    Continuar conexão quando voltar.
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </section>
      <div className="help">
        <PlugZap size={21} />
        <div>
          <b>Configuração pelo próprio painel</b>
          <p>
            Para domínios ativos na Cloudflare, o vínculo e o HTTPS são
            preparados automaticamente. Se o domínio ainda estiver em outro
            provedor, a troca de nameservers é feita no registrador onde ele foi
            comprado.
          </p>
        </div>
      </div>
    </>
  );
}
