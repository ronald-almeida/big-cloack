import React, { useMemo, useState, useEffect, useRef } from "react";
import { waitingThemes, renderWaitingPage } from "../workers/waiting-page.mjs";
export default function WaitingEditor({
  value = {},
  name,
  onChange,
  external,
}) {
  const [mobile, setMobile] = useState(false);
  const [cnpjInput, setCnpjInput] = useState(value?.cnpj || ""),
    [lookup, setLookup] = useState(null),
    [lookupError, setLookupError] = useState(""),
    [searching, setSearching] = useState(false),
    [applied, setApplied] = useState(false);
  const lookupId = useRef(0);
  useEffect(
    () => () => {
      lookupId.current++;
    },
    [],
  );
  async function searchCnpj() {
    const id = ++lookupId.current;
    setSearching(true);
    setLookupError("");
    setLookup(null);
    setApplied(false);
    try {
      const r = await fetch(
        "/api/cnpj?" + new URLSearchParams({ cnpj: cnpjInput }),
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Consulta indisponível.");
      if (id === lookupId.current) setLookup(data);
    } catch (e) {
      if (id === lookupId.current) setLookupError(e.message);
    } finally {
      if (id === lookupId.current) setSearching(false);
    }
  }
  function applyLookup() {
    const fields = Object.fromEntries(
      Object.entries(lookup.fields).filter(([, v]) =>
        Array.isArray(v) ? v.length : Boolean(v),
      ),
    );
    onChange({ ...value, ...fields });
    setLookup(null);
    setApplied(true);
  }
  const canvas = useRef(null),
    [scale, setScale] = useState(0.5);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setScale(Math.max(0.1, entry.contentRect.width / 1100)),
    );
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  const page = value || {},
    set = (key, text) => onChange({ ...page, [key]: text });
  const html = useMemo(() => renderWaitingPage(page, name), [page, name]);
  const fields = [
    ["company", "Nome / Razão social", 160],
    ["headline", "Título principal", 200],
    ["city", "Cidade / Estado", 120],
    ["cnpj", "CNPJ (opcional)", 18],
    ["opening_date", "Data de abertura (opcional)", 10, "date"],
    ["whatsapp", "WhatsApp com país e DDD", 20, "tel"],
    ["email", "E-mail de contato", 160, "email"],
  ];
  return (
    <section className="waiting-editor">
      <div className="section-heading">
        <div>
          <h2>Página de Espera</h2>
          <p>Apresentação, serviços e contato, no estilo da sua referência.</p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const options = waitingThemes.filter(
              (t) => t.id !== (page.theme || "sky"),
            );
            set(
              "theme",
              options[
                crypto.getRandomValues(new Uint32Array(1))[0] % options.length
              ].id,
            );
          }}
        >
          Variar estilo
        </button>
      </div>
      <div className="cnpj-fill">
        <label htmlFor="cnpj-search">Preencher pelo CNPJ</label>
        <div className="cnpj-search-row">
          <input
            id="cnpj-search"
            inputMode="numeric"
            maxLength={18}
            value={cnpjInput}
            placeholder="00.000.000/0000-00"
            onChange={(e) => {
              setCnpjInput(e.target.value);
              lookupId.current++;
              setLookup(null);
              setSearching(false);
              setLookupError("");
              setApplied(false);
            }}
          />
          <button
            type="button"
            className="secondary"
            disabled={searching || !cnpjInput.trim()}
            onClick={searchCnpj}
          >
            {searching ? "Consultando…" : "Buscar CNPJ"}
          </button>
        </div>
        {lookupError && (
          <p role="alert" className="error">
            {lookupError}
          </p>
        )}
        {lookup && (
          <div className="cnpj-result">
            <strong>{lookup.fields.company}</strong>
            <p>
              {lookup.fields.city} · {lookup.status || "Situação não informada"}
            </p>
            <small>
              Fonte: {lookup.source}. Ao aplicar, os campos disponíveis
              substituem o preenchimento atual. Revise as atividades e os textos
              antes de salvar. Telefone cadastral não é tratado como WhatsApp.
            </small>
            <button type="button" className="primary" onClick={applyLookup}>
              Aplicar dados da empresa
            </button>
          </div>
        )}
        {applied && (
          <p role="status">
            Dados preenchidos. Revise a página abaixo antes de salvar.
          </p>
        )}
      </div>
      {external && (
        <p className="rule-info">
          A URL externa de espera tem prioridade. Deixe esse endereço vazio para
          usar a página abaixo.
        </p>
      )}
      <div
        className="theme-options"
        role="group"
        aria-label="Variação da página"
      >
        {waitingThemes.map((t) => (
          <button
            type="button"
            key={t.id}
            aria-pressed={(page.theme || "sky") === t.id}
            onClick={() => set("theme", t.id)}
            title={t.description}
          >
            <span style={{ background: t.color }} />
            {t.name}
          </button>
        ))}
      </div>
      <div className="waiting-grid">
        <div className="waiting-fields">
          <p className="muted">
            Preencha os dados que deseja exibir. Campos opcionais vazios ficam
            ocultos.
          </p>
          {fields.map(([key, label, maxLength, type]) => (
            <label key={key}>
              {label}
              <input
                type={type || "text"}
                maxLength={maxLength}
                value={page[key] || ""}
                onChange={(e) => set(key, e.target.value)}
                placeholder={key === "whatsapp" ? "5511999999999" : undefined}
              />
            </label>
          ))}
          <label>
            Descrição da apresentação
            <textarea
              maxLength={600}
              rows={3}
              value={page.description || ""}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <label>
            Sobre a empresa
            <textarea
              maxLength={1200}
              rows={3}
              value={page.about || ""}
              onChange={(e) => set("about", e.target.value)}
            />
          </label>
          <label>
            Serviços (um por linha, até 8)
            <textarea
              rows={4}
              value={(page.services || []).join("\n")}
              onChange={(e) => set("services", e.target.value.split("\n"))}
            />
          </label>
        </div>
        <div className="waiting-preview">
          <div className="preview-toolbar">
            <b>Prévia ao vivo</b>
            <button
              type="button"
              className="secondary"
              aria-pressed={mobile}
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? "Ver desktop" : "Ver mobile"}
            </button>
          </div>
          <div
            ref={canvas}
            className={"preview-canvas " + (mobile ? "mobile" : "")}
          >
            <iframe
              style={
                mobile
                  ? {}
                  : {
                      width: 1100,
                      height: 560 / scale,
                      transform: `scale(${scale})`,
                      transformOrigin: "top left",
                    }
              }
              title="Prévia da página de Espera"
              sandbox=""
              srcDoc={html}
            />
          </div>
          <small>O conteúdo e a variação serão salvos com este link.</small>
        </div>
      </div>
    </section>
  );
}
