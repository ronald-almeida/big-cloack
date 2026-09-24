// Local-only preview: real API/SQL handlers with ephemeral test JWT and SQLite.
// This file is never bundled into Workers or Pages deployments.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { harness } from "../tests/harness.mjs";
import redirect from "../workers/redirect.mjs";
import { renderWaitingPage, waitingThemes } from "../workers/waiting-page.mjs";
const h = await harness();
if (process.argv.includes("--fixtures")) {
  const domain = await (
    await h.call("domains", "POST", { hostname: "links.example.com" })
  ).json();
  await h.env.DB.prepare("UPDATE domains SET verified=1 WHERE id=?")
    .bind(domain.id)
    .run();
  await h.call("links", "POST", {
    name: "Link de teste local",
    slug: "teste-local",
    mode: "waiting",
    device: "all",
    real_urls: ["https://example.com/a"],
    waiting_url: "",
    waiting_page: {
      theme: "sky",
      company: "Empresa de demonstração",
      headline: "Serviços próximos de você.",
      city: "Salvador / BA",
      services: ["Atendimento personalizado", "Planejamento e acompanhamento"],
    },
  });
}
const root = resolve("dist");
createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/preview/waiting/")) {
      const theme = req.url.split("/").at(-1);
      if (!waitingThemes.some((t) => t.id === theme)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        renderWaitingPage({
          theme,
          company: "Sua empresa",
          headline: "Serviços que aproximam você do que importa.",
          description:
            "Uma apresentação clara do seu trabalho, com atendimento direto e informações em um só lugar.",
          about:
            "Apresente aqui a história da sua empresa e como você ajuda seus clientes.",
          services: [
            "Descreva seu primeiro serviço",
            "Apresente sua segunda especialidade",
            "Conte como funciona seu atendimento",
          ],
          city: "Sua cidade / UF",
        }),
      );
      return;
    }
    if (req.url.startsWith("/r/")) {
      const tasks = [];
      const response = await redirect.fetch(
        new Request("https://links.example.com/" + req.url.slice(3), {
          method: req.method,
          headers: req.headers,
        }),
        h.env,
        { waitUntil: (p) => tasks.push(p) },
      );
      await Promise.allSettled(tasks);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (req.url.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const response = await h.call(
        req.url.slice(5),
        req.method,
        body ? JSON.parse(body) : undefined,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (
      !file.startsWith(
        root + "/".replace("/", process.platform === "win32" ? "\\" : "/"),
      )
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    const content = await readFile(file);
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".png": "image/png",
      }[extname(file)] || "application/octet-stream",
    );
    res.end(content);
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
}).listen(4173, "127.0.0.1", () =>
  console.log("Local preview: http://127.0.0.1:4173"),
);
