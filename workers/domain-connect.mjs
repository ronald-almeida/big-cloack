export function cloudflareConfigured(env) {
  return Boolean(
    env.CLOUDFLARE_API_TOKEN &&
    /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || ""),
  );
}
async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resposta vazia.");
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1048576) {
      await reader.cancel();
      throw new Error("Resposta muito grande.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function cf(env, path, method = "GET", data) {
  if (!cloudflareConfigured(env))
    throw new Error(
      "Configure a integração Cloudflare no servidor para conectar domínios pelo painel.",
    );
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
    method,
    headers: {
      Authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(10000),
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error("A API Cloudflare retornou um redirecionamento inesperado.");
  if ([401, 403].includes(response.status))
    throw new Error(
      "A credencial Cloudflare não tem as permissões necessárias para este domínio.",
    );
  const result = await readJson(response);
  if (!response.ok || !result.success)
    throw new Error(
      "Cloudflare: " +
        String(
          result.errors?.[0]?.message || "Não foi possível concluir a conexão.",
        ).slice(0, 300),
    );
  return result.result;
}
export async function verifyDomain(env, domain) {
  let verified = false;
  try {
    const response = await fetch(
      "https://" + domain.hostname + "/__domain-check",
      { redirect: "manual", signal: AbortSignal.timeout(7000) },
    );
    if (
      response.ok &&
      response.headers.get("content-type")?.includes("application/json")
    ) {
      const body = await readJson(response);
      verified =
        body.service === "big-cloack-redirect" && body.domain_id === domain.id;
    }
  } catch {}
  const message = verified
    ? "Domínio conectado e HTTPS respondendo."
    : domain.cloudflare_domain_id
      ? "Configuração enviada. Aguardando DNS e certificado HTTPS; use Verificar conexão para acompanhar."
      : "O domínio ainda não responde ao redirector via HTTPS. Clique em Conectar para iniciar.";
  await env.DB.prepare(
    "UPDATE domains SET verified=?,connection_status=?,connection_message=? WHERE id=?",
  )
    .bind(
      verified ? 1 : 0,
      verified
        ? "active"
        : domain.cloudflare_domain_id
          ? "provisioning"
          : domain.connection_status || "pending",
      message,
      domain.id,
    )
    .run();
  return { verified, status: verified ? "active" : "provisioning", message };
}
async function saveState(env, domain, status, message, zone) {
  await env.DB.prepare(
    "UPDATE domains SET verified=0,connection_status=?,connection_message=?,zone_id=?,zone_name=?,nameservers=? WHERE id=?",
  )
    .bind(
      status,
      message,
      zone?.id || "",
      zone?.name || "",
      JSON.stringify(zone?.name_servers || []),
      domain.id,
    )
    .run();
  return { status, message, nameservers: zone?.name_servers || [] };
}
export async function connectDomain(env, domain, input = {}) {
  if (!cloudflareConfigured(env))
    throw new Error(
      "Configure a integração Cloudflare no servidor para conectar domínios pelo painel.",
    );
  const now = Date.now(),
    lock = await env.DB.prepare(
      "UPDATE domains SET connection_lock_until=? WHERE id=? AND connection_lock_until<?",
    )
      .bind(now + 180000, domain.id, now)
      .run();
  if (!lock.meta.changes)
    throw new Error(
      "Este domínio já está sendo conectado. Aguarde e tente novamente.",
    );
  try {
    const labels = domain.hostname.split(".");
    let zone;
    for (let i = 0; i < labels.length - 1; i++) {
      const query = new URLSearchParams({
        name: labels.slice(i).join("."),
        "account.id": env.CLOUDFLARE_ACCOUNT_ID,
      });
      const zones = await cf(env, "/zones?" + query);
      zone = zones.find((z) => z.account?.id === env.CLOUDFLARE_ACCOUNT_ID);
      if (zone) break;
    }
    if (!zone && input.zone_name) {
      const name = String(input.zone_name).trim().toLowerCase();
      if (
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
          name,
        ) ||
        !(domain.hostname === name || domain.hostname.endsWith("." + name))
      )
        throw new Error(
          "Informe o domínio raiz correspondente ao endereço cadastrado.",
        );
      zone = await cf(env, "/zones", "POST", {
        name,
        account: { id: env.CLOUDFLARE_ACCOUNT_ID },
        type: "full",
      });
    }
    if (!zone)
      return await saveState(
        env,
        domain,
        "needs_zone",
        "Domínio não encontrado na conta autorizada. Você pode adicioná-lo à Cloudflare abaixo.",
      );
    if (zone.status !== "active")
      return await saveState(
        env,
        domain,
        "nameservers",
        "Atualize os nameservers no registrador do domínio. Depois clique em Continuar conexão.",
        zone,
      );
    const base = "/accounts/" + env.CLOUDFLARE_ACCOUNT_ID + "/workers/domains";
    const domains = await cf(
      env,
      base + "?" + new URLSearchParams({ hostname: domain.hostname }),
    );
    let binding = domains.find((d) => d.hostname === domain.hostname);
    if (binding && binding.service !== "big-cloack-redirect")
      throw new Error(
        "Este domínio já está conectado a outro Worker. Escolha um endereço livre.",
      );
    if (!binding) {
      const records = await cf(
        env,
        `/zones/${zone.id}/dns_records?` +
          new URLSearchParams({ name: domain.hostname, per_page: "100" }),
      );
      if (records.some((r) => ["A", "AAAA", "CNAME"].includes(r.type)))
        throw new Error(
          "Existe um registro DNS de site neste endereço. A conexão não substituiu esse registro. Use um subdomínio livre ou remova o conflito antes de tentar novamente.",
        );
      binding = await cf(env, base, "PUT", {
        hostname: domain.hostname,
        service: "big-cloack-redirect",
        zone_id: zone.id,
      });
    }
    await saveState(
      env,
      domain,
      "provisioning",
      "Aguardando DNS e certificado HTTPS.",
      zone,
    );
    await env.DB.prepare("UPDATE domains SET cloudflare_domain_id=? WHERE id=?")
      .bind(binding.id, domain.id)
      .run();
    return await verifyDomain(env, {
      ...domain,
      cloudflare_domain_id: binding.id,
    });
  } catch (error) {
    const message =
      error.name === "TimeoutError"
        ? "A Cloudflare demorou a responder. Tente novamente; uma conexão já criada será reutilizada."
        : error.message;
    await env.DB.prepare(
      "UPDATE domains SET connection_status=?,connection_message=? WHERE id=?",
    )
      .bind("error", message, domain.id)
      .run();
    throw new Error(message);
  } finally {
    await env.DB.prepare(
      "UPDATE domains SET connection_lock_until=0 WHERE id=?",
    )
      .bind(domain.id)
      .run();
  }
}

