// Run with: npm test   (Node 18+, no dependencies)

import { test } from "node:test";
import assert from "node:assert/strict";

import { exampleStore } from "../src/core/example.js";
import { generateFromAnswers, sizeOf } from "../src/core/layout.js";
import { setNb, newAisle, blankStore, byId } from "../src/core/model.js";
import { normItem, matchProduct, buildItemIndex } from "../src/routing/matching.js";
import { dijkstra, pathTo } from "../src/routing/shortestPath.js";
import { heldKarp, nearestNeighbour2Opt } from "../src/routing/stopOrder.js";
import { directions } from "../src/routing/floorGrid.js";
import { planTrip } from "../src/routing/tripPlanner.js";

const overlaps = (A) => {
  let c = 0;
  for (let i = 0; i < A.length; i++)
    for (let j = i + 1; j < A.length; j++) {
      const a = A[i], b = A[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) c++;
    }
  return c;
};

test("neighbour answers mirror onto the other aisle", () => {
  const S = blankStore(), a = newAisle(), b = newAisle();
  S.aisles = [a, b];
  setNb(S, a, "e", b.id);
  assert.equal(b.nb.w, a.id);
  setNb(S, a, "e", null);
  assert.equal(b.nb.w, undefined);
});

test("layout places every aisle without overlaps and respects sides", () => {
  const S = generateFromAnswers(exampleStore());
  assert.ok(S.aisles.every((a) => a.x != null));
  assert.equal(overlaps(S.aisles), 0);
  const a1 = S.aisles.find((a) => a.no === "1"), a2 = S.aisles.find((a) => a.no === "2");
  assert.ok(a2.x > a1.x, "aisle 2 is right of aisle 1");
  const bakery = byId(S, a2.nb.n);
  assert.ok(bakery.y + bakery.h <= a2.y, "bakery is behind aisle 2");
  assert.deepEqual(sizeOf({ no: "", orient: "h" }), { w: 12, h: 3 });
  assert.ok(S.fixtures.some((f) => f.kind === "door"));
});

test("product matching: plurals, partial and fuzzy", () => {
  assert.equal(normItem("Tomatoes"), "tomato");
  const index = buildItemIndex([{ id: "p", items: ["tomato", "peanut butter"], name: "Produce" }]);
  assert.equal(matchProduct(index, "tomatoes").type, "exact");
  assert.equal(matchProduct(index, "cherry tomato").type, "partial");
  assert.equal(matchProduct(index, "peanut buter").type, "fuzzy");
  assert.equal(matchProduct(index, "unicorn").type, null);
});

test("dijkstra and stop ordering", () => {
  const nodes = ["s", "a", "b", "e"].map((id) => ({ id }));
  const adj = new Map([["s", [{ to: "a", w: 1 }, { to: "b", w: 5 }]], ["a", [{ to: "s", w: 1 }, { to: "b", w: 1 }]], ["b", [{ to: "s", w: 5 }, { to: "a", w: 1 }, { to: "e", w: 1 }]], ["e", [{ to: "b", w: 1 }]]]);
  const { dist, prev } = dijkstra({ nodes, adj }, "s");
  assert.equal(dist.get("e"), 3);
  assert.deepEqual(pathTo(prev, "e"), ["s", "a", "b", "e"]);
  const D = (x, y) => dijkstra({ nodes, adj }, x).dist.get(y);
  assert.deepEqual(heldKarp("s", ["b", "a"], "e", D), ["a", "b"]);
  assert.deepEqual(nearestNeighbour2Opt("s", ["b", "a"], "e", D), ["a", "b"]);
});

test("directions collapse straight runs", () => {
  assert.deepEqual(directions([[0, 0], [1, 0], [2, 0], [2, -1]]), ["→ 2 ft right", "↑ 1 ft toward back"]);
});

test("trip goes entrance → stops → checkout and reports unknown items", () => {
  const S = generateFromAnswers(exampleStore());
  const trip = planTrip(S, "milk, peanut butter, bananas, chips, bread, unicorn");
  assert.ok(!trip.error);
  assert.equal(trip.legs[0].section, "ent");
  assert.equal(trip.legs.at(-1).section, "chk");
  assert.equal(trip.stopIds.size, 5);
  assert.equal(trip.total, trip.legs.reduce((s, l) => s + l.dist, 0));
  assert.deepEqual(trip.unmatched.map((u) => u.product), ["unicorn"]);
  trip.legs.slice(1).forEach((l) => assert.ok(l.cells.length > 1 && l.dirs.length > 0));
});

test("planTrip rejects an empty list", () => {
  const S = generateFromAnswers(exampleStore());
  assert.ok(planTrip(S, "  ").error);
});
