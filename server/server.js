// Zero-dependency server: serves the app and POST /api/aisle-categories.
//   ANTHROPIC_API_KEY=... npm start
// The API key stays on the server; the browser never sees it.

import http from "node:http";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateImages, callModel } from "./lib.js";
import { parseVisionReply } from "../src/services/visionParse.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = new Set(["index.html", "src", "styles"]); // nothing else is served (not .env, server/, tests/)
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const MAX_BODY = 25 * 1024 * 1024;

function loadDotEnv() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) { /* no .env file */ }
}

const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("too big"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createApp({ apiKey, model = "claude-sonnet-5-5", baseUrl, limit = 20, windowMs = 10 * 60_000 } = {}) {
  const hits = new Map(); // ip → timestamps (simple in-memory rate limit)
  const limited = (ip) => {
    const now = Date.now(), recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    return recent.length > limit;
  };

  async function categories(req, res) {
    if (!apiKey) return send(res, 501, { error: "not_configured", message: "Set ANTHROPIC_API_KEY on the server." });
    if (limited(req.socket.remoteAddress || "?")) return send(res, 429, { error: "rate_limited", message: "Too many requests. Try again in a few minutes." });
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch (e) { return send(res, e.status || 400, { error: "bad_request", message: "Could not read the request." }); }
    const v = validateImages(body);
    if (!v.images) return send(res, v.status, { error: v.error, message: v.message });
    try {
      const text = await callModel({ apiKey, baseUrl, model, images: v.images });
      return send(res, 200, parseVisionReply(text));
    } catch (e) {
      console.error("[aisle-categories]", e.message);
      const unreadable = /JSON/.test(e.message);
      return send(res, 502, { error: unreadable ? "unreadable" : "model_error", message: unreadable ? "The model's answer couldn't be understood. Try again." : "The vision model couldn't process these photos." });
    }
  }

  async function serveStatic(url, res) {
    const rel = path.posix.normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(ROOT, rel);
    if (!PUBLIC.has(rel.split("/")[0]) || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end("Not found"); }
    try {
      const data = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end("Not found"); }
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/aisle-categories") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return categories(req, res);
    }
    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "not_found" });
    return serveStatic(url, res);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotEnv();
  const port = Number(process.env.PORT) || 3000;
  const app = createApp({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.MODEL || undefined });
  app.listen(port, () => {
    console.log(`Aisle Mapper on http://localhost:${port}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log("ANTHROPIC_API_KEY is not set: photo suggestions are off.");
  });
}
