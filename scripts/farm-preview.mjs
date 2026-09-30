// Local end-to-end harness. Never deployed: real authenticated API + SQLite,
// deterministic external Cloudflare/BrasilAPI responses, no production writes.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { harness } from "../tests/harness.mjs";
import farmPublic from "../workers/farm-public.mjs";
const h = await harness(),
  original = globalThis.fetch,
  bindings = new Map();
h.env.CLOUDFLARE_API_TOKEN = "local-only";
h.env.CLOUDFLARE_ACCOUNT_ID = "a".repeat(32);
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "api.cloudflare.com") {
    let result = [];
    if (u.pathname.endsWith("/zones"))
      result = [
        {
          id: "b".repeat(32),
          name: u.searchParams.get("name"),
          status: "active",
          account: { id: h.env.CLOUDFLARE_ACCOUNT_ID },
        },
      ];
    else if (options.method === "PUT") {
      const b = JSON.parse(options.body);
      result = { ...b, id: crypto.randomUUID() };
      bindings.set(b.hostname, result);
    } else if (options.method === "DELETE") {
      for (const [k, b] of bindings)
        if (u.pathname.endsWith("/" + b.id)) bindings.delete(k);
    } else if (u.pathname.includes("/workers/domains"))
      result = [...bindings.values()].filter(
        (b) => b.hostname === u.searchParams.get("hostname"),
      );
    return Response.json({ success: true, result });
  }
  if (u.hostname === "brasilapi.com.br")
    return Response.json({
      cnpj: "53749174000118",
      razao_social: "Empresa Demonstração LTDA",
      nome_fantasia: "Empresa Demonstração",
      municipio: "Salvador",
      uf: "BA",
      cnae_fiscal_descricao: "Serviços profissionais",
      ddd_telefone_1: "71999999999",
    });
  if (
    u.hostname.endsWith(".farm-test.example") ||
    u.pathname === "/__farm-check"
  )
    return farmPublic.fetch(new Request(url), h.env);
  return original(url, options);
};
const root = resolve("dist");
createServer(async (req, res) => {
  try {
    let response;
    if (req.url.startsWith("/api/")) {
      let body = "";
      for await (const c of req) body += c;
      response = await h.call(
        req.url.slice(5),
        req.method,
        body ? JSON.parse(body) : undefined,
      );
    } else if (req.url.startsWith("/site/"))
      response = await farmPublic.fetch(
        new Request("https://" + req.url.slice(6)),
        h.env,
      );
    else {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const path = resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!path.startsWith(root)) throw Error("Invalid path");
      response = new Response(await readFile(path), {
        headers: {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "application/javascript",
              ".css": "text/css",
            }[extname(path)] || "application/octet-stream",
        },
      });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
}).listen(4173, "127.0.0.1", () =>
  console.log("Farm test preview: http://127.0.0.1:4173"),
);
