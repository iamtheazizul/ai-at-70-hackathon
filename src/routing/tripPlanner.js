// Trip planning: shopping list → matched spots → shortest ordered route with directions.
// Pure: takes a generated store, returns a plain trip object.
//
// A stop is either a whole shape (a section, or an aisle matched by its name) or an exact
// item spot inside a coded aisle: "<aisleId>:<side>:<index>", e.g. peanut butter = aisle 4, left, 2nd.

import { byId, cap } from "../core/model.js";
import { spotPoint } from "../core/geometry.js";
import { buildItemIndex, matchProduct, parseShoppingList } from "./matching.js";
import { dijkstra, pathTo } from "./shortestPath.js";
import { orderStops } from "./stopOrder.js";
import { buildStoreGraph } from "./storeGraph.js";
import { cellPath, directions } from "./floorGrid.js";

const aisleOf = (key) => key.split(":")[0];

export function nodeName(S, id) {
  if (id === "ent") return "Entrance";
  if (id === "chk") return "Checkout";
  const a = byId(S, aisleOf(id));
  return a ? (a.no ? `Aisle ${a.no} · ${a.name}` : a.name) : id;
}

/** Short shopper-facing place: "Aisle 4 · left side · about 11 ft in". */
export function placeText(S, leg) {
  if (leg.role === "start") return "Entrance";
  if (leg.role === "end") return "Checkout";
  const a = byId(S, leg.aisleId);
  if (!a) return "";
  const where = a.no ? `Aisle ${a.no}` : cap(a.name);
  return leg.side ? `${where} · ${leg.side} side · about ${leg.alongFt} ft in` : where;
}

/**
 * @returns {{error:string}} or
 *   { total, legs:[{section, aisleId, side, alongFt, role, dist, products:[{product,type,item}], via, cells, dirs}],
 *     unmatched:[{product, suggestions}], stopIds:Set<aisleId> }
 *   Cells are floor-grid coordinates (see floorGrid.RES).
 */
export function planTrip(S, listText) {
  const list = Array.isArray(listText) ? listText : parseShoppingList(listText);
  if (!list.length) return { error: "Add at least one item to the list" };
  if (!(S.fixtures || []).some((f) => f.kind === "door")) return { error: "This map has no entrance. Regenerate the map first." };

  // 1) match every product, and turn each candidate into a stop key (+ an exact spot for aisle sides)
  const index = buildItemIndex(S.aisles);
  const spots = new Map();
  const keyOf = (c) => {
    if (!c.side) return c.section;
    const key = `${c.section}:${c.side}:${c.index}`;
    if (!spots.has(key)) {
      const p = spotPoint(byId(S, c.section), c.side, c.index, c.count);
      spots.set(key, { id: key, aisleId: c.section, side: c.side, x: p.x, y: p.y, alongFt: p.alongFt });
    }
    return key;
  };
  const matched = list.map((product) => {
    const m = matchProduct(index, product);
    return { product, m, cands: m.candidates.map((c) => ({ ...c, key: keyOf(c) })) };
  });

  // 2) graph with the spots in it
  const g = buildStoreGraph(S, [...spots.values()]);
  const start = "ent", end = g.pts.has("chk") ? "chk" : null;
  const dStart = dijkstra(g, start).dist;

  const unmatched = [], resolved = [];
  for (const { product, m, cands } of matched) {
    const reachable = cands.filter((c) => dStart.get(c.key) !== Infinity);
    if (!reachable.length) { unmatched.push({ product, suggestions: m.suggestions }); continue; }
    resolved.push({ product, type: m.type, candidates: reachable });
  }

  // 3) items found in several places: prefer one we already visit, else the nearest
  const uniq = (r) => [...new Set(r.candidates.map((c) => c.key))];
  const chosen = new Set(resolved.filter((r) => uniq(r).length === 1).map((r) => uniq(r)[0]));
  const byStop = new Map();
  for (const r of resolved) {
    const keys = uniq(r);
    let pick = keys[0];
    if (keys.length > 1) {
      const already = keys.filter((x) => chosen.has(x));
      pick = (already.length ? already : keys).reduce((x, y) => (dStart.get(y) < dStart.get(x) ? y : x));
      chosen.add(pick);
    }
    if (!byStop.has(pick)) byStop.set(pick, []);
    byStop.get(pick).push({ product: r.product, type: r.type, item: r.candidates.find((c) => c.key === pick)?.item });
  }

  // 4) order the stops (Held-Karp / nearest-neighbour + 2-opt)
  const stops = [...byStop.keys()];
  const keys = [...new Set([start, ...stops, ...(end ? [end] : [])])];
  const sp = new Map(keys.map((k) => [k, dijkstra(g, k)]));
  const D = (a, b) => sp.get(a).dist.get(b);
  const order = orderStops(start, stops, end, D);
  const seq = [start, ...order, ...(end ? [end] : [])];

  // 5) expand into walking legs with grid paths and directions
  const legs = [];
  let total = 0;
  seq.forEach((key, i) => {
    const spot = spots.get(key);
    const base = { section: key, aisleId: spot ? spot.aisleId : key, side: spot?.side || null, alongFt: spot?.alongFt ?? null };
    if (!i) { legs.push({ ...base, role: "start", products: [], dist: 0, cells: [g.pts.get(key)], via: [], dirs: [] }); return; }
    const nodesPath = pathTo(sp.get(seq[i - 1]).prev, key);
    let cells = [];
    for (let k = 1; k < nodesPath.length; k++) {
      const seg = cellPath(g.search.get(nodesPath[k - 1]), g.pts.get(nodesPath[k])) || [];
      cells = cells.length ? cells.concat(seg.slice(1)) : seg;
    }
    const dist = D(seq[i - 1], key);
    total += dist;
    // "via" lists the shapes passed on the way, not the item spots
    const via = [...new Set(nodesPath.slice(1, -1).map(aisleOf))].filter((v) => v !== base.aisleId && v !== "ent" && v !== "chk");
    legs.push({ ...base, role: i === seq.length - 1 && end ? "end" : "stop", products: byStop.get(key) || [], dist, cells, via, dirs: directions(cells) });
  });

  return { total, legs, unmatched, stopIds: new Set(order.map(aisleOf)) };
}
