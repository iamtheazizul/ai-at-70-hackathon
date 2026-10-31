// Ordering the stops: start → every stop → end, shortest total (from storeRoute.js).
// D(a, b) returns the shortest distance between two sections.

/** Exact answer by Held-Karp dynamic programming. Fine up to ~12 stops. */
export function heldKarp(start, stops, end, D) {
  const n = stops.length;
  if (n === 0) return [];
  const FULL = 1 << n;
  const dp = Array.from({ length: FULL }, () => new Array(n).fill(Infinity));
  const parent = Array.from({ length: FULL }, () => new Array(n).fill(-1));
  for (let i = 0; i < n; i++) dp[1 << i][i] = D(start, stops[i]);
  for (let mask = 1; mask < FULL; mask++)
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last)) || dp[mask][last] === Infinity) continue;
      for (let nxt = 0; nxt < n; nxt++) {
        if (mask & (1 << nxt)) continue;
        const nm = mask | (1 << nxt);
        const c = dp[mask][last] + D(stops[last], stops[nxt]);
        if (c < dp[nm][nxt]) { dp[nm][nxt] = c; parent[nm][nxt] = last; }
      }
    }
  let best = Infinity, bestLast = 0;
  for (let i = 0; i < n; i++) {
    const c = dp[FULL - 1][i] + (end ? D(stops[i], end) : 0);
    if (c < best) { best = c; bestLast = i; }
  }
  const out = [];
  let mask = FULL - 1, cur = bestLast;
  while (cur !== -1) { out.unshift(stops[cur]); const p = parent[mask][cur]; mask ^= 1 << cur; cur = p; }
  return out;
}

/** Nearest-neighbour tour improved with 2-opt. For longer lists. */
export function nearestNeighbour2Opt(start, stops, end, D) {
  const left = new Set(stops), order = [];
  let cur = start;
  while (left.size) {
    let best = null;
    for (const s of left) if (best === null || D(cur, s) < D(cur, best)) best = s;
    order.push(best); left.delete(best); cur = best;
  }
  const len = (o) => [start, ...o, ...(end ? [end] : [])].reduce((a, s, i, arr) => (i ? a + D(arr[i - 1], s) : 0), 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++)
      for (let j = i + 1; j < order.length; j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (len(cand) < len(order)) { order.splice(0, order.length, ...cand); improved = true; }
      }
  }
  return order;
}

export const orderStops = (start, stops, end, D) =>
  stops.length <= 12 ? heldKarp(start, stops, end, D) : nearestNeighbour2Opt(start, stops, end, D);
