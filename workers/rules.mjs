import { validateWaitingPage } from "./waiting-page.mjs";
import { validateSlug } from "../shared/slug.mjs";
export function deviceType(headers) {
  const hint = headers.get("sec-ch-ua-mobile");
  if (hint === "?1") return "mobile";
  return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(
    headers.get("user-agent") || "",
  )
    ? "mobile"
    : "desktop";
}
export function destinationMode(link, device) {
  return link.mode === "real" &&
    (link.device === "all" || link.device === device)
    ? "real"
    : "waiting";
}
export function httpUrl(value, optional = false) {
  if (optional && !value) return "";
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("URL inválida.");
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error("Use uma URL completa com https://.");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Use uma URL HTTP ou HTTPS sem credenciais.");
  return u.href;
}
export function validateLink(input) {
  const name = String(input.name || "").trim();
  if (!name || name.length > 120)
    throw new Error("Informe um nome de até 120 caracteres.");
  const slug = validateSlug(
    input.slug || crypto.randomUUID().replaceAll("-", "").slice(0, 10),
  );
  if (
    !["real", "waiting"].includes(input.mode) ||
    !["all", "mobile", "desktop"].includes(input.device)
  )
    throw new Error("Modo ou dispositivo inválido.");
  if (!Array.isArray(input.real_urls) || input.real_urls.length > 30)
    throw new Error("Informe até 30 URLs reais.");
  const real_urls = [...new Set(input.real_urls.map((v) => httpUrl(v)))];
  if (input.mode === "real" && !real_urls.length)
    throw new Error("O modo Real precisa de ao menos uma URL.");
  return {
    name,
    slug,
    mode: input.mode,
    device: input.device,
    real_urls,
    waiting_url: httpUrl(input.waiting_url, true),
    waiting_page: validateWaitingPage(input.waiting_page),
  };
}
export function analyticsSince(days, now = Date.now()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return start.toISOString();
}
