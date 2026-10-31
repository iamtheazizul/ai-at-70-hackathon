// Builds the weighted section graph for a generated store.
// Nodes: every aisle/section + "ent" (entrance) + "chk" (checkout).
// Edges: contributor neighbour answers, physical closeness, entrance/checkout links.
// Weights: real walking distance in feet on the floor grid.

import { floorGrid, standPoint, gridSearch, cellPath } from "./floorGrid.js";

const CLOSE_CELLS = 6; // objects at most this far apart (12 ft) are treated as neighbours

export function buildStoreGraph(S) {
  const G = floorGrid(S);
  const objs = S.aisles.filter((a) => a.x != null).map((a) => a);
  const chk = (S.fixtures || []).find((f) => f.id === "chk");
  const ent = (S.fixtures || []).find((f) => f.kind === "door");
  if (chk) objs.push({ ...chk, id: "chk" });
  if (ent) objs.push({ ...ent, id: "ent", kind: "door" });

  const pts = new Map(objs.map((o) => [o.id, standPoint(G, o)]));
  const search = new Map(objs.map((o) => [o.id, gridSearch(G, pts.get(o.id))]));
  const walk = (a, b) => { const p = cellPath(search.get(a), pts.get(b)); return p ? p.length - 1 : Infinity; };

  const edgeMap = new Map();
  const add = (a, b) => {
    if (a === b || !pts.has(a) || !pts.has(b)) return;
    const k = [a, b].sort().join("|");
    if (edgeMap.has(k)) return;
    const w = walk(a, b);
    if (w < Infinity) edgeMap.set(k, { a, b, w });
  };

  // 1) neighbours the contributor entered
  S.aisles.forEach((a) => Object.values(a.nb || {}).forEach((v) => add(a.id, v === "checkout" ? "chk" : v === "entrance" ? "ent" : v)));
  // 2) anything physically close on the floor plan (covers hand-edited layouts)
  const gap = (p, q) => Math.max(0, q.x - (p.x + p.w), p.x - (q.x + q.w), q.y - (p.y + p.h), p.y - (q.y + q.h));
  objs.forEach((p, i) => objs.slice(i + 1).forEach((q) => {
    if (p.kind !== "door" && q.kind !== "door" && gap(p, q) <= CLOSE_CELLS) add(p.id, q.id);
  }));
  // 3) entrance and checkout reach their three closest sections
  ["ent", "chk"].forEach((id) => {
    if (!pts.has(id)) return;
    objs.filter((o) => o.id !== id).map((o) => [o.id, walk(id, o.id)]).sort((x, y) => x[1] - y[1]).slice(0, 3).forEach(([o]) => add(id, o));
  });

  const nodes = objs.map((o) => ({ id: o.id }));
  const makeAdj = () => {
    const m = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edgeMap.values()) { m.get(e.a).push({ to: e.b, w: e.w }); m.get(e.b).push({ to: e.a, w: e.w }); }
    return m;
  };

  // 4) join any islands to their nearest neighbour so every section is reachable
  for (let guard = 0; guard < objs.length && nodes.length; guard++) {
    const adj = makeAdj(), seen = new Set([nodes[0].id]), q = [nodes[0].id];
    while (q.length) { const u = q.shift(); for (const { to } of adj.get(u)) if (!seen.has(to)) { seen.add(to); q.push(to); } }
    const outside = nodes.filter((n) => !seen.has(n.id));
    if (!outside.length) break;
    let best = null;
    for (const o of outside) for (const s of seen) { const w = walk(o.id, s); if (w < Infinity && (!best || w < best[2])) best = [o.id, s, w]; }
    if (!best) break;
    add(best[0], best[1]);
  }

  return { nodes, adj: makeAdj(), edges: [...edgeMap.values()], pts, search, grid: G };
}
