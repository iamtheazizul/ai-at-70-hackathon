// Shortest paths on a weighted section graph (from storeRoute.js).
// graph = { nodes:[{id}], adj: Map<id, [{to, w}]> }

export function dijkstra(graph, source) {
  const dist = new Map(graph.nodes.map((n) => [n.id, Infinity]));
  const prev = new Map();
  const todo = new Set(graph.nodes.map((n) => n.id));
  dist.set(source, 0);
  while (todo.size) {
    let u = null;
    for (const id of todo) if (u === null || dist.get(id) < dist.get(u)) u = id;
    if (dist.get(u) === Infinity) break;
    todo.delete(u);
    for (const { to, w } of graph.adj.get(u)) {
      const alt = dist.get(u) + w;
      if (alt < dist.get(to)) { dist.set(to, alt); prev.set(to, u); }
    }
  }
  return { dist, prev };
}

/** Node ids from the Dijkstra source to target. */
export function pathTo(prev, target) {
  const p = [target];
  while (prev.has(p[0])) p.unshift(prev.get(p[0]));
  return p;
}
