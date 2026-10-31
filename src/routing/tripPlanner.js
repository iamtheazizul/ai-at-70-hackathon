// Trip planning: shopping list → matched sections → shortest ordered route with directions.
// Pure: takes a generated store, returns a plain trip object.

import { byId } from "../core/model.js";
import { buildItemIndex, matchProduct, parseShoppingList } from "./matching.js";
import { dijkstra, pathTo } from "./shortestPath.js";
import { orderStops } from "./stopOrder.js";
import { buildStoreGraph } from "./storeGraph.js";
import { cellPath, directions } from "./floorGrid.js";

export function nodeName(S, id) {
  if (id === "ent") return "Entrance";
  if (id === "chk") return "Checkout";
  const a = byId(S, id);
  return a ? (a.no ? `Aisle ${a.no} · ${a.name}` : a.name) : id;
}

/**
 * @returns {{error:string}} or
 *   { total, legs:[{section, role, dist, products:[{product,type,item}], via:[ids], cells:[[x,y]], dirs:[string]}],
 *     unmatched:[{product, suggestions}], stopIds:Set }
 *   Cells are floor-grid coordinates (see floorGrid.RES).
 */
export function planTrip(S, listText) {
  const list = parseShoppingList(listText);
  if (!list.length) return { error: "Add at least one item to the list" };

  const g = buildStoreGraph(S);
  const start = "ent", end = g.pts.has("chk") ? "chk" : null;
  if (!g.pts.has(start)) return { error: "This map has no entrance. Regenerate the map first." };

  // match products to sections
  const index = buildItemIndex(S.aisles);
  const dStart = dijkstra(g, start).dist;
  const unmatched = [], resolved = [];
  for (const product of list) {
    const m = matchProduct(index, product);
    const cands = m.candidates.filter((c) => dStart.get(c.section) !== Infinity);
    if (!cands.length) { unmatched.push({ product, suggestions: m.suggestions }); continue; }
    resolved.push({ product, type: m.type, candidates: cands });
  }

  // items sold in several sections: prefer one we already visit, else the nearest
  const uniq = (r) => [...new Set(r.candidates.map((c) => c.section))];
  const chosen = new Set(resolved.filter((r) => uniq(r).length === 1).map((r) => uniq(r)[0]));
  const bySection = new Map();
  for (const r of resolved) {
    const secs = uniq(r);
    let pick = secs[0];
    if (secs.length > 1) {
      const already = secs.filter((x) => chosen.has(x));
      pick = (already.length ? already : secs).reduce((x, y) => (dStart.get(y) < dStart.get(x) ? y : x));
      chosen.add(pick);
    }
    if (!bySection.has(pick)) bySection.set(pick, []);
    bySection.get(pick).push({ product: r.product, type: r.type, item: r.candidates.find((c) => c.section === pick)?.item });
  }

  // order the stops
  const stops = [...bySection.keys()];
  const keys = [...new Set([start, ...stops, ...(end ? [end] : [])])];
  const sp = new Map(keys.map((k) => [k, dijkstra(g, k)]));
  const D = (a, b) => sp.get(a).dist.get(b);
  const order = orderStops(start, stops, end, D);
  const seq = [start, ...order, ...(end ? [end] : [])];

  // expand into walking legs
  const legs = [];
  let total = 0;
  seq.forEach((section, i) => {
    if (!i) { legs.push({ section, role: "start", products: [], dist: 0, cells: [g.pts.get(section)], via: [], dirs: [] }); return; }
    const nodesPath = pathTo(sp.get(seq[i - 1]).prev, section);
    let cells = [];
    for (let k = 1; k < nodesPath.length; k++) {
      const seg = cellPath(g.search.get(nodesPath[k - 1]), g.pts.get(nodesPath[k])) || [];
      cells = cells.length ? cells.concat(seg.slice(1)) : seg;
    }
    const dist = D(seq[i - 1], section);
    total += dist;
    legs.push({
      section, role: i === seq.length - 1 && end ? "end" : "stop", products: bySection.get(section) || [],
      dist, cells, via: nodesPath.slice(1, -1), dirs: directions(cells),
    });
  });

  return { total, legs, unmatched, stopIds: new Set(order) };
}
