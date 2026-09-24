// Local-only preview: real API/SQL handlers with ephemeral test JWT and SQLite.
// This file is never bundled into Workers or Pages deployments.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { harness } from "../tests/harness.mjs";
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
    mode: "real",
    device: "all",
    real_urls: ["https://example.com/a"],
    waiting_url: "",
  });
}
const root = resolve("dist");
createServer(async (req, res) => {
  try {
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
