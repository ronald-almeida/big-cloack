import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { timingSafeEqual } from "node:crypto";
import { createEngine } from "./engine.mjs";
const token = process.env.COMPANY_SEARCH_TOKEN;
if (!token || token.length < 32 || !process.env.COMPANY_DB)
  throw Error("Configure COMPANY_DB e COMPANY_SEARCH_TOKEN (32+ caracteres).");
const run = createEngine(
  new DatabaseSync(process.env.COMPANY_DB, { readOnly: true }),
);
const expected = Buffer.from("Bearer " + token);
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    const auth = Buffer.from(req.headers.authorization || "");
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.writeHead(401);
      res.end('{"error":"Unauthorized"}');
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end('{"error":"Method not allowed"}');
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2000000)
        throw Object.assign(Error("Request too large"), { status: 413 });
      chunks.push(chunk);
    }
    const result = run(
      new URL(req.url, "http://localhost").pathname,
      JSON.parse(Buffer.concat(chunks).toString()),
    );
    res.end(JSON.stringify(result));
  } catch (e) {
    res.writeHead(e.status || 400);
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT || 4180),
  process.env.HOST || "127.0.0.1",
  () => console.log("Company search listening"),
);
