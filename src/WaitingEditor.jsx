import React, { useMemo, useState, useEffect, useRef } from "react";
import { waitingThemes, renderWaitingPage } from "../workers/waiting-page.mjs";
export default function WaitingEditor({
  value = {},
  name,
  onChange,
  external,
}) {
  const [mobile, setMobile] = useState(false);
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
