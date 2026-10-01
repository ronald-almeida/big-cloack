// Local-only: ephemeral database and simulated Access identity on recovery path.
// Never deployed; no production secrets or data are used.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { harness } from "../tests/harness.mjs";
import api from "../workers/api.mjs";
import { onRequest } from "../functions/[[path]].js";
const h = await harness();
h.env.AUTH_PASSWORD_PEPPER = crypto.randomUUID();
const root = resolve("dist");
const env = { ...h.env, ADMIN_API: { fetch: (r) => api.fetch(r, h.env) } };
createServer(async (req, res) => {
  try {
    const local = new URL(req.url, "http://localhost:4175");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks);
    const headers = new Headers(req.headers);
    if (headers.get("Origin") === local.origin)
      headers.set("Origin", env.ADMIN_ORIGIN);
    if (local.pathname.startsWith("/access-recovery"))
      headers.set("Cf-Access-Jwt-Assertion", h.jwt);
    const request = new Request(
      env.ADMIN_ORIGIN + local.pathname + local.search,
      { method: req.method, headers, body: data.length ? data : undefined },
    );
    const response = await onRequest({
      request,
      env,
      next: async () => {
        const name = local.pathname.startsWith("/assets/")
          ? local.pathname
          : "/index.html";
        const file = resolve(root, "." + name);
        if (
          !file.startsWith(root + (process.platform === "win32" ? "\\" : "/"))
        )
          return new Response(null, { status: 404 });
        return new Response(await readFile(file), {
          headers: {
            "Content-Type":
              {
                ".html": "text/html",
                ".js": "application/javascript",
                ".css": "text/css",
              }[extname(file)] || "application/octet-stream",
          },
        });
      },
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Preview failed");
  }
}).listen(4175, "127.0.0.1", () =>
  console.log(
    "Login preview: http://localhost:4175/login (recovery identity is simulated locally)",
  ),
);
