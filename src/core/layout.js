// Map generation: turns the contributors' answers (orientation + 8-point neighbours)
// into x/y/w/h positions on a grid where one cell = 2 ft. Mutates and returns the store.

import { GAP, OPP, DEFAULT_W, DEFAULT_H } from "./constants.js";
import { syncDerived } from "./model.js";

/** Footprint in cells. Coded aisles are long shelving runs; sections are deeper and shorter. */
export function sizeOf(a) {
  const section = !a.no;
  if (a.orient === "h") return section ? { w: 12, h: 3 } : { w: 15, h: 1.5 };
  return section ? { w: 3, h: 12 } : { w: 1.5, h: 15 };
}

/** Where B goes when it sits at point p of A, with a walkway in between. */
export function relPos(A, B, p) {
  let x = A.x + A.w / 2 - B.w / 2;
  let y = A.y + A.h / 2 - B.h / 2;
  if (p.includes("e")) x = A.x + A.w + GAP;
  if (p.includes("w")) x = A.x - GAP - B.w;
  if (p.includes("n")) y = A.y - GAP - B.h;
  if (p.includes("s")) y = A.y + A.h + GAP;
  return { x, y };
}

const dirOf = (p) => ({
  x: p.includes("e") ? 1 : p.includes("w") ? -1 : 0,
  y: p.includes("s") ? 1 : p.includes("n") ? -1 : 0,
});

/**
 * Breadth-first placement over the neighbour graph:
 * place one aisle, put each neighbour on its side, nudge outward on collisions,
 * then size the floor, snap wall-side aisles to walls and place checkout + entrance.
 */
export function generateFromAnswers(S) {
  S.aisles.forEach((a) => {
    a.nb = a.nb || {};
    if (!a.orient) a.orient = "v";
    syncDerived(a);
    Object.assign(a, sizeOf(a));
  });
  if (!S.aisles.some((a) => Object.keys(a.nb).length)) return generateSimple(S);

  const chk = { id: "chk", w: 12, h: 2.5 };
  const nodes = new Map(S.aisles.map((a) => [a.id, a]));
  const edges = new Map();
  const add = (f, t, p) => { if (!edges.has(f)) edges.set(f, []); edges.get(f).push([t, p]); };
  let usesChk = false, door = null;

  S.aisles.forEach((a) => Object.entries(a.nb).forEach(([p, v]) => {
    if (nodes.has(v)) { add(a.id, v, p); add(v, a.id, OPP[p]); }
    else if (v === "checkout") { usesChk = true; add(a.id, "chk", p); add("chk", a.id, OPP[p]); }
    else if (v === "entrance" && !door) door = { a, p };
  }));
  if (usesChk) nodes.set("chk", chk);

  const placed = [], done = new Set();
  const hits = (n) => placed.some((o) => n.x < o.x + o.w + 1 && n.x + n.w + 1 > o.x && n.y < o.y + o.h + 1 && n.y + n.h + 1 > o.y);
  const put = (n, x, y, d) => {
    n.x = x; n.y = y;
    for (let k = 0; hits(n) && k < 500; k++) { n.x += d.x * 0.5; n.y += d.y * 0.5; }
    placed.push(n); done.add(n.id);
  };

  for (const start of nodes.values()) {
    if (done.has(start.id)) continue;
    // each disconnected group starts to the right of everything placed so far
    put(start, placed.length ? Math.max(...placed.map((o) => o.x + o.w)) + GAP * 2 : 0, 0, { x: 1, y: 0 });
    const queue = [start];
    while (queue.length) {
      const A = queue.shift();
      for (const [tid, p] of edges.get(A.id) || []) {
        if (done.has(tid)) continue;
        const B = nodes.get(tid), r = relPos(A, B, p);
        put(B, r.x, r.y, dirOf(p));
        queue.push(B);
      }
    }
  }

  // shift into view and size the floor
  const M = 3;
  const minX = Math.min(...placed.map((o) => o.x)), minY = Math.min(...placed.map((o) => o.y));
  placed.forEach((o) => { o.x += M - minX; o.y += M - minY; });
  S.W = Math.max(30, Math.ceil(Math.max(...placed.map((o) => o.x + o.w)) + M));
  S.H = Math.max(22, Math.ceil(Math.max(...placed.map((o) => o.y + o.h)) + (usesChk ? M + 1 : 8)));

  // aisles the contributor put against a store wall
  S.aisles.forEach((a) => {
    const has = (ks) => ks.some((k) => a.nb[k] === "wall");
    if (has(["w", "nw", "sw"])) a.x = 1;
    if (has(["e", "ne", "se"])) a.x = S.W - 1 - a.w;
    if (has(["n", "nw", "ne"])) a.y = 1;
    if (has(["s", "sw", "se"])) a.y = S.H - 1 - a.h;
  });

  const fixtures = [];
  if (usesChk) fixtures.push({ id: "chk", name: "Checkout", kind: "fixture", x: chk.x, y: chk.y, w: chk.w, h: chk.h });
  else fixtures.push({ id: "chk", name: "Checkout", kind: "fixture", x: Math.round(S.W * 0.15), y: S.H - 5.5, w: Math.min(20, Math.round(S.W * 0.45)), h: 2.5 });
  let doorX = S.W - 13;
  if (door) {
    const { a, p } = door, px = a.x + (p.includes("e") ? a.w : p.includes("w") ? 0 : a.w / 2);
    doorX = Math.max(1, Math.min(S.W - 10, px - 4.5));
  }
  fixtures.push({ id: "ent", name: "Entrance", kind: "door", x: doorX, y: S.H - 1.2, w: 9, h: 1.2 });

  S.fixtures = fixtures;
  S.placed = true;
  S.dirty = false;
  return S;
}

/** Fallback when nobody has entered neighbours: sections on the walls, aisles in a numbered row. */
export function generateSimple(S) {
  S.W = DEFAULT_W; S.H = DEFAULT_H;
  const W = S.W, H = S.H;
  const walls = S.aisles.filter((a) => a.kind === "wall"), aisles = S.aisles.filter((a) => a.kind !== "wall");
  const back = [], left = [], right = [];
  walls.forEach((w, i) => (i % 3 === 0 ? back : i % 3 === 1 ? left : right).push(w));
  const place = (arr, fn) => arr.forEach((w, i) => Object.assign(w, fn(i, arr.length)));
  place(back, (i, n) => { const s = Math.floor((W - 12) / n); return { x: 6 + i * s, y: 1, w: s - 1, h: 3 }; });
  place(left, (i, n) => { const s = Math.floor((H - 14) / n); return { x: 1, y: 6 + i * s, w: 3, h: s - 1 }; });
  place(right, (i, n) => { const s = Math.floor((H - 14) / n); return { x: W - 4, y: 6 + i * s, w: 3, h: s - 1 }; });
  aisles.sort((a, b) => (parseFloat(a.no) || 0) - (parseFloat(b.no) || 0) || String(a.no).localeCompare(b.no));
  const n = Math.max(aisles.length, 1), pitch = Math.min(4, (W - 14) / n), sx = 7 + ((W - 14) - pitch * n) / 2;
  aisles.forEach((a, i) => Object.assign(a, { x: Math.round(sx + i * pitch + (pitch - 1.5) / 2), y: 7, w: 1.5, h: 15 }));
  S.fixtures = [
    { id: "chk", name: "Checkout", kind: "fixture", x: 10, y: H - 6, w: 20, h: 2.5 },
    { id: "ent", name: "Entrance", kind: "door", x: W - 14, y: H - 1.2, w: 9, h: 1.2 },
  ];
  S.placed = true;
  S.dirty = false;
  return S;
}
