export const SLUG_ERROR =
  "Slug: use 3 a 64 caracteres no total: letras minúsculas, números, hífen, sublinhado ou barras (/). Não use //, barra no início/fim ou segmentos vazios.";

export function normalizeSlug(value) {
  return String(value).trim().toLowerCase();
}

export function validateSlug(value) {
  const slug = normalizeSlug(value);
  if (
    slug.length < 3 ||
    slug.length > 64 ||
    !/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/.test(slug)
  )
    throw new Error(SLUG_ERROR);
  if (["api", "health", "__domain-check"].includes(slug))
    throw new Error("Slug reservado. Escolha outro endereço.");
  return slug;
}

export function cloakLinkUrl(hostname, slug) {
  // Keep separators literal: encoding the whole slug would turn / into %2F.
  return `https://${hostname}/${slug}`;
}
