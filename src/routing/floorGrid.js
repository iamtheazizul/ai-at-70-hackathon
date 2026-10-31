// Walking on the floor plan. The floor is rasterised at half a map cell (1 ft per step);
// shelves and counters are blocked, everything else is walkway.

import { dimsOf } from "../core/model.js";
import { shelfStrips } from "../core/geometry.js";

export const RES = 0.5; // map cells per grid step → one step = 1 ft

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export function floorGrid(S) {
  const { W, H } = dimsOf(S);
  const gw = Math.round(W / RES), gh = Math.round(H / RES), blk = new Uint8Array(gw * gh);
  const mark = (o) => {
    const x0 = Math.max(0, Math.floor(o.x / RES)), y0 = Math.max(0, Math.floor(o.y / RES));
    const x1 = Math.min(gw, Math.ceil((o.x + o.w) / RES)), y1 = Math.min(gh, Math.ceil((o.y + o.h) / RES));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blk[y * gw + x] = 1;
  };
  // only the shelves block walking; an aisle's walkway stays open
  S.aisles.forEach((a) => a.x != null && shelfStrips(a).forEach(mark));
  (S.fixtures || []).filter((f) => f.kind === "fixture").forEach(mark);
  return { gw, gh, blk, free: (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && !blk[y * gw + x] };
}

export function nearestFree(G, x, y) {
  if (G.free(x, y)) return [x, y];
  for (let r = 1; r < Math.max(G.gw, G.gh); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && G.free(x + dx, y + dy)) return [x + dx, y + dy];
  return [x, y];
}

/** Where a shopper stands to shop an object. Aisles: the middle of their walkway.
 *  Sections: the open long side with the widest walkway in front of it. */
export function standPoint(G, o) {
  if (o.kind === "door") return nearestFree(G, Math.floor((o.x + o.w / 2) / RES), G.gh - 1);
  if (o.kind === "aisle") return nearestFree(G, Math.floor((o.x + o.w / 2) / RES), Math.floor((o.y + o.h / 2) / RES));
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, vert = o.h > o.w;
  const longSides = vert ? [[o.x - 0.5, cy, -1, 0], [o.x + o.w + 0.5, cy, 1, 0]] : [[cx, o.y - 0.5, 0, -1], [cx, o.y + o.h + 0.5, 0, 1]];
  const ends = vert ? [[cx, o.y - 0.5, 0, -1], [cx, o.y + o.h + 0.5, 0, 1]] : [[o.x - 0.5, cy, -1, 0], [o.x + o.w + 0.5, cy, 1, 0]];
  let best = null, bestClear = -1;
  [...longSides, ...ends].forEach(([x, y, dx, dy], k) => {
    const gx = Math.floor(x / RES), gy = Math.floor(y / RES);
    if (!G.free(gx, gy)) return;
    let clear = 0;
    while (clear < 14 && G.free(gx + dx * clear, gy + dy * clear)) clear++;
    if (k >= 2) clear -= 6; // prefer long sides over the ends
    if (clear > bestClear) { bestClear = clear; best = [gx, gy]; }
  });
  return best || nearestFree(G, Math.floor(cx / RES), Math.floor(cy / RES));
}

/** Single-source grid search with a small turn penalty, so paths run straight down walkways. */
export function gridSearch(G, [sx, sy], turnPenalty = 2.5) {
  const N = G.gw * G.gh, cost = new Float64Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
  const heap = new MinHeap(), DX = [1, -1, 0, 0], DY = [0, 0, -1, 1], s = sy * G.gw + sx;
  for (let d = 0; d < 4; d++) { cost[s * 4 + d] = 0; heap.push(0, s * 4 + d); }
  while (heap.size) {
    const [c, st] = heap.pop();
    if (c > cost[st]) continue;
    const cell = st >> 2, d = st & 3, x = cell % G.gw, y = (cell / G.gw) | 0;
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DX[nd], ny = y + DY[nd];
      if (!G.free(nx, ny)) continue;
      const ns = (ny * G.gw + nx) * 4 + nd, nc = c + 1 + (nd !== d ? turnPenalty : 0);
      if (nc < cost[ns]) { cost[ns] = nc; prev[ns] = st; heap.push(nc, ns); }
    }
  }
  return { cost, prev, gw: G.gw };
}

/** Grid cells [[x,y],…] from a search's source to target, or null if unreachable. */
export function cellPath(R, [tx, ty]) {
  const cell = ty * R.gw + tx;
  let best = -1, bc = Infinity;
  for (let d = 0; d < 4; d++) if (R.cost[cell * 4 + d] < bc) { bc = R.cost[cell * 4 + d]; best = cell * 4 + d; }
  if (best < 0) return null;
  const out = [];
  for (let st = best; st >= 0; st = R.prev[st]) out.push(st >> 2);
  return out.reverse().map((c) => [c % R.gw, (c / R.gw) | 0]);
}

/** Collapse a cell path into straight runs: "↑ 34 ft toward back", "→ 9 ft right". */
export function directions(cells) {
  const runs = [];
  for (let i = 1; i < cells.length; i++) {
    const dx = cells[i][0] - cells[i - 1][0], dy = cells[i][1] - cells[i - 1][1];
    const d = dx > 0 ? "right" : dx < 0 ? "left" : dy < 0 ? "back" : "front";
    if (runs.length && runs.at(-1).d === d) runs.at(-1).n++; else runs.push({ d, n: 1 });
  }
  const ARROW = { right: "→", left: "←", back: "↑", front: "↓" };
  const WORD = { right: "right", left: "left", back: "toward back", front: "toward front" };
  return runs.map((r) => `${ARROW[r.d]} ${r.n} ft ${WORD[r.d]}`);
}
