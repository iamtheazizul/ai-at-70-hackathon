// Photo → categories: parsing, request validation, and the HTTP endpoint against a fake model API.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { parseVisionReply, cleanCategories, cleanAisleNo } from "../src/services/visionParse.js";
import { validateImages, buildRequest, MAX_IMAGES } from "../server/lib.js";
import { createApp } from "../server/server.js";

test("parses plain, fenced and prose-wrapped JSON", () => {
  const want = { categories: ["cereal", "oatmeal"], aisleNo: "7" };
  const json = '{"aisle_number":"7","categories":["Cereal","oatmeal"]}';
  assert.deepEqual(parseVisionReply(json), want);
  assert.deepEqual(parseVisionReply("```json\n" + json + "\n```"), want);
  assert.deepEqual(parseVisionReply("Here you go: " + json + " Hope that helps."), want);
});

test("unusable replies throw", () => {
  assert.throws(() => parseVisionReply("I can't see anything"), /No JSON/);
  assert.throws(() => parseVisionReply("{not json}"), /valid JSON/);
});

test("categories are cleaned, deduplicated and capped", () => {
  assert.deepEqual(cleanCategories([" Cereal ", "cereal", "Peanut  Butter.", "", 5, null, "x".repeat(41)]), ["cereal", "peanut butter"]);
  assert.equal(cleanCategories(Array.from({ length: 30 }, (_, i) => "item" + i)).length, 12);
  assert.deepEqual(cleanCategories("nope"), []);
});

test("aisle numbers: digits with an optional letter, nothing else", () => {
  assert.equal(cleanAisleNo("7"), "7");
  assert.equal(cleanAisleNo(12), "12");
  assert.equal(cleanAisleNo("12b"), "12B");
  assert.equal(cleanAisleNo("Produce"), null);
  assert.equal(cleanAisleNo(null), null);
  assert.equal(cleanAisleNo("1234"), null);
});

const img = { mediaType: "image/jpeg", data: "QUJD" };

test("request validation", () => {
  assert.ok(validateImages({ images: [img] }).images);
  assert.equal(validateImages({}).error, "no_images");
  assert.equal(validateImages({ images: Array(MAX_IMAGES + 1).fill(img) }).error, "too_many");
  assert.equal(validateImages({ images: [{ mediaType: "image/gif", data: "QUJD" }] }).error, "bad_image");
  assert.equal(validateImages({ images: [{ mediaType: "image/jpeg", data: "not base64!" }] }).error, "bad_image");
});

test("model request puts photos first, then the prompt", () => {
  const r = buildRequest([img, img], "m");
  const c = r.messages[0].content;
  assert.equal(r.model, "m");
  assert.deepEqual(c.map((b) => b.type), ["image", "image", "text"]);
  assert.equal(c[0].source.media_type, "image/jpeg");
});

// --- endpoint, with a fake model API on an ephemeral port ---
const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const post = (port, body) => fetch(`http://127.0.0.1:${port}/api/aisle-categories`, { method: "POST", body: JSON.stringify(body) });

test("endpoint: reads photos through the model and returns clean data", async () => {
  let seen;
  const fake = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      seen = { headers: req.headers, body: JSON.parse(b) };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text: '{"aisle_number":"4","categories":["Condiments","peanut butter"]}' }] }));
    });
  });
  const fakePort = await listen(fake);
  const app = createApp({ apiKey: "k", model: "test-model", baseUrl: `http://127.0.0.1:${fakePort}` });
  const port = await listen(app);
  const res = await post(port, { images: [img] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { categories: ["condiments", "peanut butter"], aisleNo: "4" });
  assert.equal(seen.headers["x-api-key"], "k");
  assert.equal(seen.body.model, "test-model");
  app.closeAllConnections(); app.close(); fake.closeAllConnections(); fake.close();
});

test("endpoint: no key → 501, bad input → 400, upstream failure → 502, rate limit → 429", async () => {
  const noKey = createApp({});
  const p1 = await listen(noKey);
  assert.equal((await post(p1, { images: [img] })).status, 501);
  noKey.closeAllConnections(); noKey.close();

  const fake = http.createServer((req, res) => { res.statusCode = 500; res.end("boom"); });
  const fp = await listen(fake);
  const app = createApp({ apiKey: "k", baseUrl: `http://127.0.0.1:${fp}`, limit: 2 });
  const p2 = await listen(app);
  assert.equal((await post(p2, { images: [] })).status, 400);
  const bad = await post(p2, { images: [img] });
  assert.equal(bad.status, 502);
  assert.equal((await bad.json()).error, "model_error");
  assert.equal((await post(p2, { images: [img] })).status, 429); // 3rd request in the window, over the limit of 2
  app.closeAllConnections(); app.close(); fake.closeAllConnections(); fake.close();
});

test("static files: app is served, secrets and server code are not", async () => {
  const app = createApp({});
  const port = await listen(app);
  const get = (p) => fetch(`http://127.0.0.1:${port}${p}`);
  assert.equal((await get("/")).status, 200);
  assert.equal((await get("/src/main.js")).status, 200);
  assert.equal((await get("/.env")).status, 404);
  assert.equal((await get("/server/lib.js")).status, 404);
  assert.equal((await get("/package.json")).status, 404);
  assert.equal((await get("/src/../.env")).status, 404);
  assert.equal((await get("/%2e%2e/etc/passwd")).status, 404);
  app.closeAllConnections(); app.close();
});
