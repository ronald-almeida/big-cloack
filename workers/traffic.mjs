/** @typedef {import('../shared/traffic.d.ts').TrafficAssessment} TrafficAssessment */
const bounded = (value, max = 2048) =>
  typeof value === "string" ? value.slice(0, max) : null;
const bool = (value) => (typeof value === "boolean" ? value : null);
const integer = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : null;
const signatures = [
  ["whatsapp", /\bWhatsApp\b/i],
  [
    "meta",
    /facebookexternalhit|\bFacebot\b|meta-externalagent|meta-externalfetcher/i,
  ],
  [
    "google",
    /Googlebot|GoogleOther|Google-InspectionTool|AdsBot-Google|Mediapartners-Google|Storebot-Google|Google-Extended|FeedFetcher-Google/i,
  ],
  ["bing", /bingbot|BingPreview|adidxbot|MicrosoftPreview/i],
  [
    "other",
    /DuckDuckBot|YandexBot|Baiduspider|Applebot|PetalBot|Bytespider|Amazonbot|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|CCBot|cohere-ai|AhrefsBot|SemrushBot|MJ12bot|DotBot|rogerbot|Sogou|Exabot|ia_archiver|archive\.org_bot|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|Pinterestbot|SkypeUriPreview|bitlybot|UptimeRobot|Pingdom|StatusCake/i,
  ],
  [
    "other",
    /\b(?:bot|crawler|spider|scraper)\b|[a-z]bot(?:\/|\b)|HeadlessChrome|PhantomJS|Playwright|Puppeteer|Selenium|python-requests|python-urllib|aiohttp|Scrapy|curl\/|Wget\/|Go-http-client|libwww-perl|node-fetch|undici|axios\//i,
  ],
];
// ASN/organization is corroboration only; shared cloud networks do not verify a bot.
const providerNetworks = {
  meta: [32934],
  google: [15169, 36040],
  bing: [8075],
  whatsapp: [32934],
};

export function collectTraffic(request) {
  const cf = request.cf || {},
    bm = cf.botManagement || {};
  return {
    user_agent: bounded(request.headers.get("user-agent")),
    ip: bounded(request.headers.get("cf-connecting-ip"), 64),
    country: bounded(cf.country, 8) || "XX",
    asn: integer(cf.asn, 1, 4294967295),
    request_method: request.method,
    referer: bounded(request.headers.get("referer")),
    cf_ray: bounded(request.headers.get("cf-ray"), 128),
    signals: {
      cf_score: integer(bm.score, 1, 99),
      verified_bot: bool(bm.verifiedBot),
      signed_agent: bool(bm.signedAgent),
      corporate_proxy: bool(bm.corporateProxy),
      js_detection_passed: bool(bm.jsDetection?.passed),
      static_resource: bool(bm.staticResource),
      ja3: bounded(bm.ja3Hash, 128),
      ja4: bounded(bm.ja4, 128),
      detection_ids: Array.isArray(bm.detectionIds)
        ? bm.detectionIds.filter(Number.isSafeInteger).slice(0, 32)
        : null,
      verified_bot_category: bounded(cf.verifiedBotCategory, 128),
      as_organization: bounded(cf.asOrganization, 256),
      colo: bounded(cf.colo, 16),
      http_protocol: bounded(cf.httpProtocol, 32),
      tls_version: bounded(cf.tlsVersion, 32),
      accept: bounded(request.headers.get("accept"), 256),
      accept_language: bounded(request.headers.get("accept-language"), 256),
      fetch_mode: bounded(request.headers.get("sec-fetch-mode"), 32),
      fetch_dest: bounded(request.headers.get("sec-fetch-dest"), 32),
      fetch_site: bounded(request.headers.get("sec-fetch-site"), 32),
      fetch_user: bounded(request.headers.get("sec-fetch-user"), 8),
      ua_mobile: bounded(request.headers.get("sec-ch-ua-mobile"), 8),
      purpose: bounded(
        request.headers.get("sec-purpose") || request.headers.get("purpose"),
        64,
      ),
    },
  };
}

/** Confidence is an ordinal automation score, not a calibrated probability.
 * @returns {TrafficAssessment}
 */
export function classifyTraffic(traffic, recentRequests = null) {
  const s = traffic.signals,
    ua = traffic.user_agent || "",
    reasons = [];
  let score = 0;
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  const provider =
    signatures.find(([, pattern]) => pattern.test(ua))?.[0] || "unknown";
  if (provider !== "unknown")
    add(
      65,
      "User-Agent declara crawler, preview ou cliente automatizado; pode ser falsificado.",
    );
  if (providerNetworks[provider]?.includes(traffic.asn))
    add(
      10,
      "ASN compatível com o provider declarado; não comprova identidade.",
    );
  if (!ua) add(10, "User-Agent ausente.");
  if (!s.accept) add(5, "Header Accept ausente.");
  if (!s.accept_language)
    add(5, "Accept-Language ausente; também ocorre em clientes legítimos.");
  if (/prefetch|preview/i.test(s.purpose || ""))
    add(20, "Requisição declara prefetch/preview; pode vir de navegador.");
  const browser =
    /Mozilla\/5\.0/.test(ua) && /Chrome\/|Firefox\/|Safari\//.test(ua);
  const navigation = s.fetch_mode === "navigate" && s.fetch_dest === "document";
  if (browser && !s.fetch_mode)
    add(5, "Sem Fetch Metadata; isoladamente não indica bot.");
  if (
    /Amazon|Google Cloud|Microsoft|DigitalOcean|OVH|Hetzner|Vultr|Linode|Oracle Cloud/i.test(
      s.as_organization || "",
    )
  )
    add(
      10,
      "Organização de rede compatível com cloud/datacenter; sinal fraco, pode incluir usuários.",
    );
  if (s.corporate_proxy === true)
    reasons.push(
      "Proxy corporativo identificado pela Cloudflare; não implica automação.",
    );
  if (s.js_detection_passed === false)
    reasons.push(
      "JavaScript detection não passou; primeira visita ou bloqueio de JS também explicam isso.",
    );
  if (recentRequests !== null && recentRequests >= 30)
    add(
      recentRequests >= 100 ? 45 : 25,
      `${recentRequests >= 100 ? "100+" : recentRequests} requisições anteriores do IP neste domínio em 60s; NAT pode compartilhar IP.`,
    );
  if (s.cf_score !== null) {
    if (s.cf_score < 30) {
      score = Math.max(score, 100 - s.cf_score);
      reasons.push(
        `Cloudflare Bot Management score ${s.cf_score}/99 indica automação.`,
      );
    } else
      reasons.push(
        `Cloudflare Bot Management score ${s.cf_score}/99 (maior indica comportamento humano).`,
      );
  }
  const verified = s.verified_bot === true || s.signed_agent === true;
  if (verified) {
    score = 100;
    reasons.push(
      "Automação verificada pela Cloudflare; provider exibido continua sendo uma atribuição provável.",
    );
  }
  if (provider === "whatsapp")
    reasons.push(
      "WhatsApp/Meta preview é apenas provável; não há verificação específica de identidade do WhatsApp.",
    );
  let classification = verified
    ? "confirmed_bot"
    : score >= 60
      ? "probable_bot"
      : "unknown";
  if (
    classification === "unknown" &&
    score < 20 &&
    browser &&
    s.accept?.includes("text/html") &&
    s.accept_language &&
    (navigation || s.cf_score >= 80)
  ) {
    classification = "human";
    reasons.push(
      "Sinais consistentes com navegação humana; não é prova de humanidade.",
    );
  }
  if (!reasons.length) reasons.push("Evidência insuficiente para classificar.");
  return {
    classification,
    is_bot:
      classification === "unknown"
        ? null
        : classification === "human"
          ? false
          : true,
    bot_confidence: Math.min(verified ? 100 : 95, score),
    bot_provider: provider,
    bot_reason: reasons,
    classifier_version: 1,
    traffic_signals: { ...s, recent_requests_60s: recentRequests },
  };
}

// Analytics never participates in destination selection. Bounded indexed history
// is approximate under concurrency; no unbounded scan or isolate-local counters.
export async function recordTraffic(
  request,
  env,
  link,
  hostname,
  device,
  destination,
  createdAt,
) {
  const traffic = collectTraffic(request);
  let recent = null;
  if (traffic.ip) {
    try {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM (SELECT id FROM clicks WHERE hostname=? AND ip=? AND created_at>=? AND created_at<=? LIMIT 100)",
      )
        .bind(
          hostname,
          traffic.ip,
          new Date(Date.parse(createdAt) - 60000).toISOString(),
          createdAt,
        )
        .first();
      recent = row.total;
    } catch {
      console.error("traffic_frequency_unavailable");
    }
  }
  const assessment = classifyTraffic(traffic, recent);
  const row = {
    link_id: link.id,
    hostname,
    device,
    destination,
    country: traffic.country,
    created_at: createdAt,
    link_name: link.name,
    slug: link.slug,
    classification: assessment.classification,
    is_bot: assessment.is_bot === null ? null : Number(assessment.is_bot),
    bot_confidence: assessment.bot_confidence,
    bot_provider: assessment.bot_provider,
    bot_reason: JSON.stringify(assessment.bot_reason),
    user_agent: traffic.user_agent,
    ip: traffic.ip,
    asn: traffic.asn,
    request_method: traffic.request_method,
    referer: traffic.referer,
    cf_ray: traffic.cf_ray,
    traffic_signals: JSON.stringify(assessment.traffic_signals),
    classifier_version: assessment.classifier_version,
  };
  await env.DB.prepare(
    `INSERT INTO clicks(${Object.keys(row).join(",")}) VALUES(${Object.keys(row)
      .map(() => "?")
      .join(",")})`,
  )
    .bind(...Object.values(row))
    .run();
}
