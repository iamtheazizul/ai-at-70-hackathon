import { test } from "node:test";
import assert from "node:assert/strict";

import { exampleStore } from "../src/core/example.js";
import { generateFromAnswers } from "../src/core/layout.js";
import { storeToRows, rowsToStore, slugify } from "../src/data/dbMapping.js";
import { planTrip } from "../src/routing/tripPlanner.js";

const ctx = { storeId: "s-uuid", mapVersionId: "mv-uuid", floorId: "f-uuid", userId: "u-uuid" };

test("rows use the schema's names, units and enums", () => {
  const S = generateFromAnswers(exampleStore());
  const rows = storeToRows(S, ctx);
  const a4 = rows.layout_shapes.find((s) => s.code === "4");
  assert.equal(a4.kind, "aisle");
  assert.equal(a4.orient, "vertical");
  assert.equal(a4.flow, "furthest_to_closest");
  assert.equal(a4.w_m, 3.048); // 5 cells = 10 ft
  const cats = rows.layout_shape_categories.filter((c) => c.shape_client_id === a4.client_id);
  assert.deepEqual(cats.map((c) => [c.side, c.label]).slice(0, 2), [["left", "condiments"], ["left", "peanut butter"]]);
  assert.ok(rows.layout_neighbours.some((n) => n.target_special === "checkout"));
  assert.deepEqual(rows.layout_fixtures.map((f) => f.kind).sort(), ["checkout", "entrance"]);
  assert.equal(rows.store.slug, "maple-street-market");
});

test("store → rows → store keeps everything a trip needs", () => {
  const S = generateFromAnswers(exampleStore());
  const back = rowsToStore(storeToRows(S, ctx));
  const a = S.aisles.find((x) => x.no === "4"), b = back.aisles.find((x) => x.no === "4");
  assert.deepEqual([b.left, b.right, b.flow, b.orient, b.nb], [a.left, a.right, a.flow, a.orient, a.nb]);
  assert.ok(Math.abs(b.x - a.x) < 0.01 && Math.abs(b.w - a.w) < 0.01);
  assert.equal(planTrip(back, "milk, honey").total, planTrip(S, "milk, honey").total);
});

test("reading back from uuids works too", () => {
  const rows = storeToRows(generateFromAnswers(exampleStore()), ctx);
  rows.layout_shapes.forEach((s, i) => (s.id = `uuid-${i}`));
  const uuidOf = new Map(rows.layout_shapes.map((s) => [s.client_id, s.id]));
  rows.layout_shape_categories.forEach((c) => { c.shape_id = uuidOf.get(c.shape_client_id); delete c.shape_client_id; });
  rows.layout_neighbours.forEach((n) => {
    n.shape_id = uuidOf.get(n.shape_client_id); delete n.shape_client_id;
    if (n.target_client_id) { n.target_shape_id = uuidOf.get(n.target_client_id); delete n.target_client_id; }
  });
  const S = rowsToStore(rows);
  assert.equal(S.aisles.find((a) => a.no === "4").right.length, 3);
  assert.ok(Object.keys(S.aisles[0].nb).length > 0);
});

test("slugs match the schema's pattern", () => {
  assert.equal(slugify("  Joe's Market #2 "), "joe-s-market-2");
  assert.match(slugify("Ünïcödé Shop"), /^[a-z0-9]+(-[a-z0-9]+)*$/);
});
