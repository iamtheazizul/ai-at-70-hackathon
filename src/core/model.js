// Store data model: creating stores and aisles, derived fields, neighbour answers.
// Pure functions — no DOM — so they run in the browser and in Node.

import { DEPTS, KEYWORDS, OPP, SPECIAL, DEFAULT_W, DEFAULT_H } from "./constants.js";

export const uid = () => Math.random().toString(36).slice(2, 9);
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const parseItems = (s) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
export const dimsOf = (S) => ({ W: S.W || DEFAULT_W, H: S.H || DEFAULT_H });
export const byId = (S, id) => S.aisles.find((a) => a.id === id);
export const shelfFt = (a) => a.ht || (a.kind === "wall" ? 5 : 6);

export function blankStore() {
  return { name: "", address: "", count: 0, stage: "address", cur: 0, reached: 0, aisles: [], fixtures: [], placed: false };
}

export function newAisle() {
  return { id: uid(), no: "", items: [], orient: null, flow: null, nb: {}, dept: "Other", kind: "aisle", name: "", color: DEPTS.Other };
}

export function guessDept(a) {
  const t = (a.items.join(" ") + " " + (a.customName ? a.name : "")).toLowerCase();
  for (const [d, ks] of Object.entries(KEYWORDS)) if (ks.some((k) => t.includes(k))) return d;
  return "Other";
}

/** Recompute kind, department, color and display name from what the contributor entered. */
export function syncDerived(a) {
  a.kind = a.no ? "aisle" : "wall"; // no code → a section such as Produce
  if (!a.customDept) {
    a.dept = guessDept(a);
    if (!a.customColor) a.color = DEPTS[a.dept];
  }
  if (!a.customName) a.name = a.items.length ? a.items.slice(0, 2).map(cap).join(" & ") : a.no ? `Aisle ${a.no}` : "Section";
}

export const aisleTitle = (a) => (a.no ? `aisle ${a.no}` : cap(a.items[0]) || "this section");
export const shortLabel = (a) => (a.no ? `${a.no} · ${cap(a.items[0] || "")}` : cap(a.items[0] || "Section"));

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

/** Rows that can't be generated yet: they need a code or category, and an orientation. */
export const incompleteRows = (S) =>
  S.aisles.map((a, i) => ((!a.items.length && !a.no) || !a.orient ? i : -1)).filter((i) => i >= 0);

/** Fill in missing fields on store JSON that came from somewhere else. */
export function normalizeImported(d) {
  if (!d || !Array.isArray(d.aisles)) throw new Error('Store JSON needs an "aisles" list');
  d.aisles.forEach((a) => {
    a.id = a.id || uid(); a.items = a.items || []; a.nb = a.nb || {}; a.no = a.no || "";
    a.dept = a.dept in DEPTS ? a.dept : "Other";
    a.kind = a.kind || (a.no ? "aisle" : "wall");
    a.name = a.name || a.items[0] || "Section";
    a.orient = a.orient || ((a.h || 0) > (a.w || 1) ? "v" : "h");
  });
  return { ...blankStore(), ...d, stage: "map", reached: 4 };
}

/* --- search helpers shared by the 2D and 3D views --- */
export const itemMatches = (a, q) => (q ? a.items.filter((i) => i.toLowerCase().includes(q)) : []);
export const nameMatches = (a, q) => !!q && (a.name.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q));
export const isHit = (a, q) => itemMatches(a, q).length > 0 || nameMatches(a, q);
