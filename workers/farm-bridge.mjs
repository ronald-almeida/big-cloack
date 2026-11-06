import { farmAPI, unpublishFarm } from "./farm-api.mjs";
import { farmHostname } from "../shared/farm.mjs";
import { farmRows, farmReadError, invalidateFarmRead } from './farm-read-cache.mjs';

export const bridgePath = "/api/operacao-farm";
const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const fail = (condition, message, status = 400) => {
  if (!condition) throw Object.assign(Error(message), { status });
};
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const owns = (record, actor) => {
  fail(record, "Registro não encontrado.", 404);
  fail(
    actor.role === "admin" || record.owner === actor.id,
    "Acesso não autorizado.",
    403,
  );
  return record;
};
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
const dateAt = at => dateFormatter.format(at);
const labels = {
  "farm-site": "Edição",
  "farm-domain": "Domínio",
  "farm-domain-toggle": "Domínio",
  "farm-domain-verify": "Domínio",
  "farm-domain-delete": "Domínio",
  "farm-delete": "Exclusão",
  "farm-publish": "Publicação",
  "farm-unpublish": "Retirada",
  "farm-verify": "Verificação",
};

export async function bridgeState(env, actor, options) {
  const snapshot = await farmRows(env, options);
  const [ds, ss, hs, os, ops] = snapshot.rows;
  const ownership = (kind, id) =>
    os.results.find((o) => o.kind === kind && o.entity_id === id) || {
      owner: "ADMIN",
      bm: "",
    };
  const sites = ss.results.map((s) => ({
    id: s.id,
    domain_id: s.domain_id,
    subdomain: s.subdomain,
    publish_mode: s.publish_mode,
    company: s.company,
    data: JSON.parse(s.data),
    theme: s.theme,
    head: s.head,
    version: s.version,
    status: s.status === "published" ? "ready" : s.status,
    last_error: s.last_error,
    pending_address: !!s.pending_address,
    created: Date.parse(s.created_at),
    updated: Date.parse(s.updated_at),
    ...ownership("site", s.id),
    snapshot: s.published_data
      ? {
          data: JSON.parse(s.published_data),
          theme: s.published_theme,
          head: s.published_head,
          version: s.published_version,
          hostname: farmHostname(
            s,
            ds.results.find((d) => d.id === s.domain_id),
          ),
        }
      : null,
  }));
  const domains = ds.results.map(({ operation_id, operation_until, ...d }) => ({
    ...d,
    active: !!d.active,
    nameservers: JSON.parse(d.nameservers),
    ...ownership("domain", d.id),
    created: Date.parse(d.created_at),
    site_count: sites.filter((s) => s.domain_id === d.id).length,
    otherSites: sites.some((s) => s.domain_id === d.id && s.owner !== actor.id),
    rootOccupied: sites.some(
      (s) => s.domain_id === d.id && s.publish_mode === "root" && s.snapshot,
    ),
  }));
  const history = hs.results.map((h) => ({
    id: h.id,
    site: h.site_id,
    company: h.company,
    owner: ownership("site", h.site_id).owner,
    action: h.action,
    message: h.message,
    status: h.status,
    who: "Farm BM",
    at: Date.parse(h.created_at),
    date: dateAt(Date.parse(h.created_at)),
  }));
  const events = ops.results.map((o) => {
    const r = JSON.parse(o.response || "{}"),
      action = r.event || labels[o.command],
      at = o.completed_at || o.created_at;
    return {
      id: "FARM-" + o.id,
      entity: o.entity_id,
      type: "Farm · " + action,
      text: r.message || action,
      who: o.actor_name,
      employee: o.actor_role === "employee" ? o.actor_id : null,
      at,
      date: dateAt(at),
      time: new Date(at).toLocaleTimeString("pt-BR", {
        timeZone: "America/Bahia",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  });
  for (const o of ops.results) {
    const r = JSON.parse(o.response || "{}");
    history.push({
      id: "OP-" + o.id,
      site: o.entity_id,
      owner: ownership("site", o.entity_id).owner,
      action: r.event || labels[o.command],
      message: r.message || "Operação registrada no BIG OPERAÇÃO",
      who: o.actor_name,
      at: o.completed_at || o.created_at,
      date: dateAt(o.completed_at || o.created_at),
    });
  }
  return {
    farm: {
      version: 2,
      source: "cloudflare-d1",
      available: true,
      writable: env.FARM_BRIDGE_MODE === "write" && !snapshot.error,
      stale: !!snapshot.error,
      fetchedAt: snapshot.at,
      error: snapshot.error?.message,
      errorCode: snapshot.error?.code,
      retryAt: snapshot.error?.retryAt,
      domains,
      sites,
      history: history
        .sort((a, b) => b.at - a.at),
    },
    events: events.filter(
      (e) => actor.role === "admin" || e.employee === actor.id,
    ),
  };
}

async function command(env, actor, input) {
  const { cmd, id, data = {}, requestId } = input;
  fail(Object.hasOwn(labels, cmd), "Comando Farm inválido.", 404);
  fail(
    /^[a-f0-9-]{36}$/i.test(requestId || ""),
    "Identificador da operação inválido.",
  );
  const fingerprint = await hash(
    JSON.stringify({
      actor,
      cmd,
      id: id || null,
      data,
      replace: input.replace || null,
    }),
  );
  const previous = await env.DB.prepare(
    "SELECT * FROM farm_operations WHERE id=?",
  )
    .bind(requestId)
    .first();
  if (previous) {
    fail(
      previous.actor_id === actor.id && previous.fingerprint === fingerprint,
      "Identificador reutilizado com outra operação.",
      409,
    );
    fail(
      previous.state !== "pending",
      "Operação ainda em processamento ou interrompida. Confira o estado do site antes de tentar novamente.",
      409,
    );
    return json(JSON.parse(previous.response), previous.response_status);
  }
  const entity = id || requestId,
    lease = crypto.randomUUID(),
    now = Date.now();
  const acquired = await env.DB.prepare(
    "UPDATE farm_bridge_lock SET lease=?,expires=? WHERE id=1 AND expires<?",
  )
    .bind(lease, now + 180000, now)
    .run();
  fail(
    acquired.meta.changes,
    "Outra operação Farm está em andamento. Aguarde.",
    409,
  );
  let claimed = false;
  try {
    const { farm } = await bridgeState(env, { id: "ADMIN", role: "admin" }, {fresh:true});
    const site = id ? farm.sites.find((s) => s.id === id) : null,
      domain = id ? farm.domains.find((d) => d.id === id) : null;
    if (cmd.startsWith("farm-domain")) {
      if (id) {
        owns(domain, actor);
        fail(
          actor.role === "admin" ||
            !farm.sites.some((s) => s.domain_id === id && s.owner !== actor.id),
          "Domínio compartilhado: solicite ao administrador.",
          403,
        );
      } else fail(cmd === "farm-domain", "Selecione um domínio.");
    } else if (id) owns(site, actor);
    else fail(cmd === "farm-site", "Selecione um site.");
    if (cmd === "farm-delete")
      fail(!site.snapshot, "Retire a publicação antes de excluir.");
    const newOwner =
      actor.role === "admin" ? data.owner || site?.owner || "ADMIN" : actor.id;
    fail(
      typeof newOwner === "string" && newOwner.length <= 80,
      "Responsável inválido.",
    );
    // Domain names used by either panel are never eligible for Farm publication.
    if (cmd === "farm-domain" && !id) {
      const h = String(data.hostname || "").trim().toLowerCase();
      for (const origin of [env.ADMIN_ORIGIN, env.FARM_OPERACAO_ORIGIN].filter(
        Boolean,
      )) {
        const reserved = new URL(origin).hostname;
        fail(
          h !== reserved && !reserved.endsWith("." + h),
          "Endereço reservado ao painel.",
        );
      }
    }
    if (cmd === "farm-publish" && site.publish_mode === "root") {
      const occupant = farm.sites.find(
        (s) =>
          s.id !== id &&
          s.domain_id === site.domain_id &&
          s.publish_mode === "root" &&
          s.snapshot,
      );
      if (occupant) {
        owns(occupant, actor);
        fail(
          input.replace?.id === occupant.id &&
            input.replace?.version === occupant.snapshot.version,
          "A raiz está ocupada. Atualize e confirme a substituição.",
          409,
        );
      }
    }
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO farm_operations(id,actor_id,actor_name,actor_role,fingerprint,command,entity_id,state,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)",
    )
      .bind(
        requestId,
        actor.id,
        actor.name,
        actor.role,
        fingerprint,
        cmd,
        entity,
        now,
      )
      .run();
    fail(inserted.meta.changes, "Esta operação já está em processamento.", 409);
    claimed = true;
    let method = "POST",
      path = "",
      payload = data,
      response;
    if (cmd === "farm-site") {
      method = id ? "PUT" : "POST";
      path = "/sites" + (id ? "/" + id : "");
    }
    if (cmd === "farm-domain") {
      method = id ? "PUT" : "POST";
      path = "/domains" + (id ? "/" + id : "");
    }
    if (cmd === "farm-domain-toggle") {
      method = "PUT";
      path = "/domains/" + id;
      payload = { active: data.active };
    }
    if (cmd === "farm-domain-verify") {
      method = "PUT";
      path = "/domains/" + id;
      payload = { verify: true };
    }
    if (cmd === "farm-domain-delete") {
      method = "DELETE";
      path = "/domains/" + id;
    }
    if (cmd === "farm-delete") {
      method = "DELETE";
      path = "/sites/" + id;
    }
    if (cmd === "farm-publish") {
      path = "/sites/" + id + "/publish";
      payload = {
        replace_root_site_id: input.replace?.id,
        replace_root_version: input.replace?.version,
      };
    }
    if (cmd === "farm-verify") path = "/sites/" + id + "/verify";
    if (cmd === "farm-unpublish") response = json(await unpublishFarm(env, id));
    else
      response = await farmAPI(
        new Request(env.ADMIN_ORIGIN + "/api/farm" + path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "DELETE" ? undefined : JSON.stringify(payload),
        }),
        env,
        (r) => r.json(),
        { id: entity },
      );
    const result = await response.json();
    const action = cmd === "farm-site" && !id ? "Site criado" : labels[cmd];
    const final = response.ok
      ? { ...result, id: entity, event: action }
      : result;
    const writes = [];
    if (response.ok && (cmd === "farm-site" || cmd === "farm-domain"))
      writes.push(
        env.DB.prepare(
          "INSERT INTO farm_ownership(kind,entity_id,owner,bm) VALUES(?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET owner=excluded.owner,bm=excluded.bm",
        ).bind(
          cmd === "farm-site" ? "site" : "domain",
          entity,
          cmd === "farm-domain" ? domain?.owner || actor.id : newOwner,
          cmd === "farm-site" ? String(data.bm || "") : "",
        ),
      );
    writes.push(
      env.DB.prepare(
        "UPDATE farm_operations SET state=?,response=?,response_status=?,completed_at=? WHERE id=?",
      ).bind(
        response.ok ? "done" : "failed",
        JSON.stringify(final),
        response.status,
        Date.now(),
        requestId,
      ),
    );
    await env.DB.batch(writes);
    return json(final, response.status);
  } catch (error) {
    // A pending receipt is deliberately retained if execution was interrupted:
    // retrying it cannot duplicate a publication or create an extra site.
    if (claimed)
      console.error("farm_bridge_interrupted", requestId, error.name);
    throw error;
  } finally {
    invalidateFarmRead(env);
    await env.DB.prepare(
      "UPDATE farm_bridge_lock SET lease=NULL,expires=0 WHERE id=1 AND lease=?",
    )
      .bind(lease)
      .run();
  }
}

export async function farmBridge(request, env, readBody) {
  try {
    fail(
      ["read", "write"].includes(env.FARM_BRIDGE_MODE),
      "Integração Farm indisponível.",
      503,
    );
    fail(request.method === "POST", "Método não permitido.", 405);
    const actual = await hash(request.headers.get("authorization") || "");
    const matches = async (secret) => {
      if (typeof secret !== "string" || secret.length < 32) return false;
      const expected = await hash("Bearer " + secret);
      let different = 0;
      for (let i = 0; i < actual.length; i++)
        different |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
      return !different;
    };
    const canWrite = await matches(env.FARM_BRIDGE_SECRET),
      canRead = canWrite || (await matches(env.FARM_BRIDGE_READ_SECRET));
    fail(canRead, "Acesso não autorizado.", 401);
    const input = await readBody(request),
      actor = input.actor;
    fail(
      actor &&
        typeof actor.id === "string" &&
        actor.id.length <= 80 &&
        typeof actor.name === "string" &&
        actor.name.length <= 80 &&
        ["admin", "employee"].includes(actor.role) &&
        (actor.role !== "admin" || actor.id === "ADMIN"),
      "Identidade inválida.",
      403,
    );
    if (input.action === "state") {
      const result = await bridgeState(env, actor);
      if (!canWrite) result.farm.writable = false;
      return json(result);
    }
    fail(input.action === "command", "Ação inválida.", 404);
    fail(
      canWrite && env.FARM_BRIDGE_MODE === "write",
      "A integração está em conferência. Alterações ainda não foram habilitadas.",
      409,
    );
    return await command(env, actor, input);
  } catch (error) {
    if (!error.status) {
      error = farmReadError(error);
      console.error('farm_bridge_unavailable', error.code);
    }
    return json(
      {
        code: error.code,
        retryAt: error.retryAt,
        error: error.status
          ? error.message
          : "Não foi possível concluir a operação da Farm. Confira o estado antes de repetir.",
      },
      error.status || 503,
    );
  }
}
