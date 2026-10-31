// Store data model: creating stores and aisles, derived fields, neighbour answers, flow and sides.
// Pure functions — no DOM — so they run in the browser and in Node.
//
// Two kinds of shape:
//   aisle   (has a code, kind "aisle"): a walkway with shelves on both sides.
//           Categories live in a.left / a.right, in shelf order, as you walk in the flow direction.
//           a.items is derived: [...left, ...right].
//   section (no code, kind "wall"): Produce, Bakery… one block, categories in a.items.

import { DEPTS, KEYWORDS, OPP, SPECIAL, DEFAULT_W, DEFAULT_H, FLOWS_FOR, REVERSE_FLOW } from "./constants.js";

export const uid = () => Math.random().toString(36).slice(2, 9);
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const parseItems = (s) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
export const dimsOf = (S) => ({ W: S.W || DEFAULT_W, H: S.H || DEFAULT_H });
export const byId = (S, id) => S.aisles.find((a) => a.id === id);
export const shelfFt = (a) => a.ht || (a.kind === "wall" ? 5 : 6);
export const isAisle = (a) => a.kind === "aisle";

export function blankStore() {
  return { id: uid(), name: "", address: "", count: 0, stage: "address", cur: 0, reached: 0, aisles: [], fixtures: [], placed: false };
}

export function newAisle() {
  return { id: uid(), no: "", items: [], left: [], right: [], orient: null, flow: null, nb: {}, dept: "Other", kind: "aisle", name: "", color: DEPTS.Other };
}

/* ---------- orientation, flow, sides ---------- */

/** "v" or "h". Once placed on the map, the shape's real proportions win. */
export const orientOf = (a) => (a.w != null && a.h != null ? (a.h >= a.w ? "v" : "h") : a.orient || "v");

/** The flow to use: the contributor's answer if it fits the orientation, else the default for it. */
export function effectiveFlow(a) {
  const fits = FLOWS_FOR[orientOf(a)];
  return a.flow && fits.includes(a.flow) ? a.flow : fits[0];
}

export function setOrient(a, o) {
  a.orient = o;
  if (a.flow && !FLOWS_FOR[o].includes(a.flow)) a.flow = null; // old flow no longer makes sense
}

/** Reversing the walking direction swaps what's on your left and right, so swap the lists
 *  to keep every category on the same physical shelf. */
export function setFlow(a, f) {
  if (a.flow && f === REVERSE_FLOW[a.flow]) {
    [a.left, a.right] = [a.right, a.left];
    a.items = [...a.left, ...a.right];
  }
  a.flow = f;
}

/* ---------- derived fields ---------- */

export function guessDept(a) {
  const t = (a.items.join(" ") + " " + (a.customName ? a.name : "")).toLowerCase();
  for (const [d, ks] of Object.entries(KEYWORDS)) if (ks.some((k) => t.includes(k))) return d;
  return "Other";
}

/** Recompute kind, item list, department, color and display name from what the contributor entered. */
export function syncDerived(a) {
  a.kind = a.no ? "aisle" : "wall"; // no code → a section such as Produce
  a.left = a.left || [];
  a.right = a.right || [];
  if (a.kind === "aisle") {
    // a section that just got a code keeps its categories, on the left side
    if (!a.left.length && !a.right.length && a.items.length) a.left = [...a.items];
    a.items = [...a.left, ...a.right];
  }
  if (!a.customDept) {
    a.dept = guessDept(a);
    if (!a.customColor) a.color = DEPTS[a.dept];
  }
  if (!a.customName) a.name = a.items.length ? a.items.slice(0, 2).map(cap).join(" & ") : a.no ? `Aisle ${a.no}` : "Section";
}

export const aisleTitle = (a) => (a.no ? `aisle ${a.no}` : cap(a.items[0]) || "this section");
export const shortLabel = (a) => (a.no ? `${a.no} · ${cap(a.items[0] || "")}` : cap(a.items[0] || "Section"));

/* ---------- neighbours ---------- */

export function nbLabel(S, v) {
  if (!v) return "";
  if (SPECIAL[v]) return SPECIAL[v];
  const b = byId(S, v);
  return b ? shortLabel(b) : "";
}

/** Set what's next to point p of aisle a. Mirrors the answer onto the other aisle. */
export function setNb(S, a, p, v) {
  const old = a.nb[p];
  const oldB = old && byId(S, old);
  if (oldB && oldB.nb[OPP[p]] === a.id) delete oldB.nb[OPP[p]];
  if (v) a.nb[p] = v; else delete a.nb[p];
  const b = v && byId(S, v);
  if (b && !b.nb[OPP[p]]) b.nb[OPP[p]] = a.id;
  if (S.placed) S.dirty = true;
}

export function removeAisle(S, id) {
  S.aisles = S.aisles.filter((x) => x.id !== id);
  S.aisles.forEach((a) => { for (const p in a.nb) if (a.nb[p] === id) delete a.nb[p]; });
  S.count = S.aisles.length;
}

/** Resize the aisle list to n rows, dropping neighbour answers that point at removed rows. */
export function setAisleCount(S, n) {
  S.count = n;
  while (S.aisles.length < n) S.aisles.push(newAisle());
  if (S.aisles.length > n) {
    const gone = new Set(S.aisles.slice(n).map((a) => a.id));
    S.aisles = S.aisles.slice(0, n);
    S.aisles.forEach((a) => { for (const p in a.nb) if (gone.has(a.nb[p])) delete a.nb[p]; });
  }
}

/** What's missing on a row, or "" when it's complete. */
export function rowProblem(a) {
  if (!a.no && !a.items.length) return "Add a code or a category";
  if (!a.orient) return "Pick an orientation";
  if (a.no && !a.flow) return "Pick which way the aisle flows";
  return "";
}
export const incompleteRows = (S) => S.aisles.map((a, i) => (rowProblem(a) ? i : -1)).filter((i) => i >= 0);

/** Fill in missing fields on store JSON that came from somewhere else. */
export function normalizeImported(d) {
  if (!d || !Array.isArray(d.aisles)) throw new Error('Store JSON needs an "aisles" list');
  d.aisles.forEach((a) => {
    a.id = a.id || uid(); a.items = a.items || []; a.nb = a.nb || {}; a.no = a.no || "";
    a.left = a.left || []; a.right = a.right || [];
    a.dept = a.dept in DEPTS ? a.dept : "Other";
    a.kind = a.kind || (a.no ? "aisle" : "wall");
    a.name = a.name || a.items[0] || "Section";
    a.orient = a.orient || ((a.h || 0) > (a.w || 1) ? "v" : "h");
  });
  return { ...blankStore(), ...d, id: d.id || uid(), stage: "map", reached: 4 };
}

/* --- search helpers shared by the 2D and 3D views --- */
export const itemMatches = (a, q) => (q ? a.items.filter((i) => i.toLowerCase().includes(q)) : []);
export const nameMatches = (a, q) => !!q && (a.name.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q));
export const isHit = (a, q) => itemMatches(a, q).length > 0 || nameMatches(a, q);
