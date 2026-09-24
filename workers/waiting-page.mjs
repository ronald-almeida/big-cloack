import { waitingCSS } from "./waiting-style.mjs";
export const waitingThemes = [
  {
    id: "sky",
    name: "Azul suave",
    color: "#2486b1",
    description: "Leve, centralizado e com cartões arredondados.",
  },
  {
    id: "forest",
    name: "Verde editorial",
    color: "#305b46",
    description: "Tons naturais, títulos serifados e capa dividida.",
  },
  {
    id: "midnight",
    name: "Escuro moderno",
    color: "#223b61",
    description: "Capa escura, detalhes em azul e linhas retas.",
  },
  {
    id: "sand",
    name: "Areia clássico",
    color: "#98603c",
    description: "Fundo quente e apresentação elegante.",
  },
  {
    id: "violet",
    name: "Violeta",
    color: "#6753ad",
    description: "Gradiente suave e capa centralizada.",
  },
];
export function validateWaitingPage(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Página de espera inválida.");
  const theme = value.theme || "sky";
  if (!waitingThemes.some((t) => t.id === theme))
    throw new Error("Escolha uma variação válida.");
  const page = { theme },
    limits = {
      company: 160,
      headline: 200,
      description: 600,
      about: 1200,
      city: 120,
      cnpj: 18,
      opening_date: 10,
      whatsapp: 20,
      email: 160,
    };
  for (const [key, limit] of Object.entries(limits)) {
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new Error(`Campo ${key} inválido.`);
    page[key] = (value[key] || "").trim();
    if (page[key].length > limit)
      throw new Error(`Campo ${key}: máximo de ${limit} caracteres.`);
  }
  page.whatsapp = page.whatsapp.replace(/[+\s().-]/g, "");
  if (page.whatsapp && !/^\d{10,15}$/.test(page.whatsapp))
    throw new Error("WhatsApp: informe o código do país, DDD e número.");
  if (page.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(page.email))
    throw new Error("Informe um e-mail válido.");
  if (page.cnpj && !/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(page.cnpj))
    throw new Error("Informe o CNPJ com 14 dígitos.");
  if (
    page.opening_date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(page.opening_date) ||
      !Number.isFinite(Date.parse(page.opening_date)) ||
      new Date(page.opening_date).toISOString().slice(0, 10) !==
        page.opening_date)
  )
    throw new Error("Data de abertura inválida.");
  if (value.services !== undefined && !Array.isArray(value.services))
    throw new Error("Serviços inválidos.");
  page.services = (value.services || [])
    .map((s) => {
      if (typeof s !== "string" || s.length > 180)
        throw new Error("Cada serviço deve ter até 180 caracteres.");
      return s.trim();
    })
    .filter(Boolean);
  if (page.services.length > 8) throw new Error("Informe até 8 serviços.");
  return page;
}
export function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function renderWaitingPage(
  value = {},
  fallback = "Informações",
  year = new Date().getUTCFullYear(),
) {
  const p = value && typeof value === "object" ? value : {};
  const theme = waitingThemes.some((t) => t.id === p.theme) ? p.theme : "sky";
  const company = escapeHtml(p.company || fallback || "Informações");
  const headline = escapeHtml(p.headline || "Conheça nosso trabalho.");
  const services = Array.isArray(p.services)
    ? p.services.filter((s) => typeof s === "string")
    : [];
  const digits = String(p.whatsapp || "").replace(/[+\s().-]/g, "");
  const whatsapp = /^\d{10,15}$/.test(digits) ? "https://wa.me/" + digits : "";
  const email =
    p.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p.email)
      ? "mailto:" + p.email
      : "";
  const facts = [
    ["Nome / Razão social", p.company || fallback],
    ["CNPJ", p.cnpj],
    ["Localização", p.city],
    ["Data de abertura", p.opening_date?.split("-").reverse().join("/")],
  ].filter(([, v]) => v);
  const factCards = facts
    .map(
      ([k, v]) =>
        `<div class="fact"><small>${escapeHtml(k)}</small><strong>${escapeHtml(v)}</strong></div>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${company}</title><meta name="description" content="${escapeHtml(p.description || "Conheça nossos serviços e informações de contato.")}"><style>${waitingCSS}</style></head><body>
 <header class="top" id="inicio"><div class="wrap"><a href="#inicio" class="brand"><span class="mark">${escapeHtml((p.company || fallback || "I").trim().charAt(0).toUpperCase())}</span><span><strong>${company}</strong><small>${escapeHtml(p.city || "Informações e atendimento")}</small></span></a><nav aria-label="Menu principal"><a href="#sobre">Sobre</a><a href="#servicos">Serviços</a><a href="#contato">Contato</a></nav></div></header>
 <main><section class="hero"><div class="wrap hero-grid"><div><span class="eyebrow">${escapeHtml(p.city || "Apresentação")}</span><h1>${headline}</h1><p>${escapeHtml(p.description || "Conheça nossos serviços e encontre as informações para entrar em contato.")}</p><div class="actions"><a class="button" href="#servicos">Conhecer serviços</a><a class="button light" href="${escapeHtml(whatsapp || "#contato")}">${whatsapp ? "Chamar no WhatsApp" : "Entre em contato"}</a></div></div><div class="hero-facts">${factCards}</div></div></section>
 <section class="section"><div class="wrap"><div class="section-title"><span class="eyebrow">Como podemos ajudar</span><h2>Conheça nossa atuação</h2></div><div class="cards"><article class="card" id="sobre"><span class="number">01 / SOBRE</span><h3>Sobre nós</h3><p>${escapeHtml(p.about || "Este espaço reúne nossas informações de apresentação e contato.")}</p></article><article class="card" id="servicos"><span class="number">02 / SERVIÇOS</span><h3>Nossos serviços</h3>${services.length ? "<ul>" + services.map((s) => "<li>" + escapeHtml(s) + "</li>").join("") + "</ul>" : "<p>Informações sobre serviços serão disponibilizadas em breve.</p>"}</article><article class="card" id="contato"><span class="number">03 / CONTATO</span><h3>Fale conosco</h3><div class="contact">${whatsapp ? '<a href="' + escapeHtml(whatsapp) + '">Conversar pelo WhatsApp ↗</a>' : ""}${email ? '<a href="' + escapeHtml(email) + '">' + escapeHtml(p.email) + "</a>" : ""}${!whatsapp && !email ? "<p>Os canais de atendimento serão divulgados aqui.</p>" : ""}${p.city ? "<p>" + escapeHtml(p.city) + "</p>" : ""}</div></article></div></div></section>
 <section class="details"><div class="wrap"><span class="eyebrow">Apresentação institucional</span><h2>Informações da empresa</h2><div class="facts">${factCards}</div></div></section></main>
 <footer><div class="wrap"><div><strong>${company}</strong>${p.cnpj ? "<small>CNPJ: " + escapeHtml(p.cnpj) + "</small>" : ""}<small>© ${year} · Informações e contato</small></div><a href="#inicio">Voltar ao início ↑</a></div></footer></body></html>`;
}
