// Draws a store's floor plan into an <svg>. Shared by the map editor and the shopper's trip view.

import { DEPTS } from "../core/constants.js";
import { dimsOf, isAisle, isHit, orientOf, effectiveFlow } from "../core/model.js";
import { shelfStrips } from "../core/geometry.js";
import { RES } from "../routing/floorGrid.js";
import { css, fit } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";
const MONO = "JetBrains Mono, monospace", BODY = "Atkinson Hyperlegible, sans-serif";

export function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent && parent.appendChild(e);
  return e;
}

/**
 * @param root  the <svg> element
 * @param S     store with positions
 * @param opts  { editable, q (search text), sel (aisle id), trip, activeLeg (index, shopper view),
 *                drag: {obj, sx, sy, text} while something is being dragged }
 * @returns number of aisles matching the search
 */
export function drawPlan(root, S, opts = {}) {
  const { editable = false, q = "", sel = null, trip = null, activeLeg = null, drag = null } = opts;
  const { W, H } = dimsOf(S), v = css;
  root.setAttribute("viewBox", `-1 -1 ${W + 2} ${H + 2}`);
  root.innerHTML = "";

  // floor, grid, scale
  el("rect", { x: 0, y: 0, width: W, height: H, fill: v("--floor"), stroke: v("--ink"), "stroke-width": 0.25 }, root);
  const g = el("g", { stroke: v("--grid"), "stroke-width": 0.05 }, root);
  for (let x = 1; x < W; x++) el("line", { x1: x, y1: 0, x2: x, y2: H }, g);
  for (let y = 1; y < H; y++) el("line", { x1: 0, y1: y, x2: W, y2: y }, g);
  el("line", { x1: 1, y1: H - 0.6, x2: 6, y2: H - 0.6, stroke: v("--muted"), "stroke-width": 0.12 }, root);
  el("text", { x: 1, y: H - 1, fill: v("--muted"), "font-size": 0.7, "font-family": MONO }, root).textContent = "10 ft";
  el("text", { x: W / 2, y: -0.25, "text-anchor": "middle", fill: v("--muted"), "font-size": 0.6, "font-family": MONO }, root).textContent = "BACK OF STORE";

  drawFixtures(root, S, editable, W, H);

  let hits = 0;
  S.aisles.forEach((a) => {
    if (a.x == null) return;
    const hit = isHit(a, q);
    if (hit) hits++;
    const attrs = { class: (editable ? "blk" : "") + (q && !hit ? " dim" : ""), "data-id": a.id };
    if (editable) Object.assign(attrs, { tabindex: 0, role: "button", "aria-label": `${a.no ? "Aisle " + a.no + ", " : ""}${a.name}` });
    const gg = el("g", attrs, root);
    if (isAisle(a)) drawAisle(gg, a); else drawSection(gg, a);
    const ring = (pad, stroke, width, dash) => el("rect", { x: a.x - pad, y: a.y - pad, width: a.w + 2 * pad, height: a.h + 2 * pad, rx: pad + 0.15, fill: "none", stroke, "stroke-width": width, ...(dash ? { "stroke-dasharray": dash } : {}) }, gg);
    if (hit && q) ring(0.35, v("--tag"), 0.3);
    if (sel === a.id) ring(0.3, v("--ink"), 0.15, ".5 .3");
    if (trip?.stopIds.has(a.id)) ring(0.25, v("--accent"), 0.22);
  });

  if (trip) drawTrip(root, trip, activeLeg);
  if (drag) drawDrag(root, drag, W);
  return hits;
}

function drawFixtures(root, S, editable, W, H) {
  const v = css;
  (S.fixtures || []).forEach((f) => {
    if (f.kind === "door") {
      el("rect", { x: f.x, y: H - 0.35, width: f.w, height: 0.7, fill: v("--floor") }, root);
      el("path", { d: `M${f.x + f.w / 2} ${H - 1.6} l-.7 .7 m.7 -.7 l.7 .7 m-.7 -.7 v1.5`, stroke: v("--accent"), "stroke-width": 0.18, fill: "none" }, root);
      el("text", { x: f.x + f.w / 2, y: H - 2, "text-anchor": "middle", fill: v("--accent"), "font-size": 0.75, "font-weight": 700, "font-family": MONO }, root).textContent = "ENTRANCE";
      return;
    }
    const gg = el("g", editable ? { class: "blk", "data-fx": f.id } : {}, root);
    el("rect", { x: f.x, y: f.y, width: f.w, height: f.h, rx: 0.3, fill: v("--floor"), stroke: v("--muted"), "stroke-width": 0.12, "stroke-dasharray": ".4 .3" }, gg);
    for (let i = 1; i < Math.floor(f.w / 3); i++) el("rect", { x: f.x + i * 3 - 0.5, y: f.y + 0.4, width: 1, height: Math.max(0.2, f.h - 0.8), fill: v("--line") }, gg);
    el("text", { x: f.x + f.w / 2, y: f.y - 0.35, "text-anchor": "middle", fill: v("--muted"), "font-size": 0.7, "font-family": MONO }, gg).textContent = f.name.toUpperCase();
  });
}

/** Shelf-tag with the aisle code, at the end the aisle starts from. */
function drawTag(gg, a, vert, flow) {
  if (!a.no) return 0;
  const tw = Math.max(1.6, String(a.no).length * 0.75 + 0.6);
  let tx, ty;
  if (vert) { tx = a.x + a.w / 2 - tw / 2; ty = flow === "cf" ? a.y + a.h + 0.2 : a.y - 1.7; }
  else { ty = a.y + a.h / 2 - 0.75; tx = flow === "rl" ? a.x + a.w + 0.2 : a.x - tw - 0.2; }
  el("rect", { x: tx, y: ty, width: tw, height: 1.5, rx: 0.2, fill: css("--tag") }, gg);
  el("text", { x: tx + tw / 2, y: ty + 1.12, "text-anchor": "middle", fill: css("--tag-ink"), "font-size": 1.05, "font-weight": 700, "font-family": MONO }, gg).textContent = a.no;
  return tw;
}

/** Coded aisle: tinted walkway with a solid shelf strip on each side. */
function drawAisle(gg, a) {
  const color = a.color || DEPTS[a.dept] || DEPTS.Other, vert = orientOf(a) === "v", flow = effectiveFlow(a);
  el("rect", { x: a.x, y: a.y, width: a.w, height: a.h, fill: color, "fill-opacity": 0.13 }, gg);
  shelfStrips(a).forEach((s) => el("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: 0.15, fill: color }, gg));
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2, fs = 0.72;
  el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", fill: css("--ink"), "font-size": fs, "font-weight": 700, "font-family": BODY, ...(vert ? { transform: `rotate(-90 ${cx} ${cy})` } : {}) }, gg)
    .textContent = fit(a.name, ((vert ? a.h : a.w) - 4) / (fs * 0.55));
  // walking-direction arrow near the far end
  const ang = { cf: -90, fc: 90, lr: 0, rl: 180 }[flow];
  const px = vert ? cx : flow === "lr" ? a.x + a.w - 1.3 : a.x + 1.3;
  const py = vert ? (flow === "cf" ? a.y + 1.3 : a.y + a.h - 1.3) : cy;
  el("path", { d: "M.5 0 L-.4 -.5 L-.4 .5 Z", fill: color, transform: `translate(${px} ${py}) rotate(${ang})` }, gg);
  drawTag(gg, a, vert, flow);
}

/** Section (Produce, Bakery…): one solid block. */
function drawSection(gg, a) {
  const color = a.color || DEPTS[a.dept] || DEPTS.Other, vert = a.h > a.w;
  el("rect", { x: a.x, y: a.y, width: a.w, height: a.h, rx: 0.25, fill: color }, gg);
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  if (vert) {
    const fs = Math.min(0.75, a.w * 0.5);
    el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", fill: "#fff", "font-size": fs, "font-weight": 700, "font-family": BODY, transform: `rotate(-90 ${cx} ${cy})` }, gg).textContent = fit(a.name, (a.h - 1) / (fs * 0.55));
  } else {
    const fs = Math.min(0.8, a.h * 0.4);
    el("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", fill: "#fff", "font-size": fs, "font-weight": 700, "font-family": BODY }, gg).textContent = fit(a.name, (a.w - 1) / (fs * 0.55));
  }
}

/** Route lines with arrows and numbered stops. With activeLeg, done legs fade and the current one stands out. */
function drawTrip(root, trip, activeLeg) {
  const c = ([x, y]) => [(x + 0.5) * RES, (y + 0.5) * RES], acc = css("--accent"), muted = css("--muted");
  const state = (i) => (activeLeg == null ? "on" : i < activeLeg ? "done" : i === activeLeg ? "on" : "next");
  trip.legs.forEach((l, i) => {
    if (l.cells.length < 2) return;
    const s = state(i), points = l.cells.map((p) => c(p).join(",")).join(" ");
    const stroke = s === "done" ? muted : acc, width = s === "on" ? 0.34 : 0.22, op = s === "next" ? 0.35 : s === "done" ? 0.45 : 1;
    el("polyline", { points, fill: "none", stroke: css("--floor"), "stroke-width": width + 0.25, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: op }, root);
    el("polyline", { points, fill: "none", stroke, "stroke-width": width, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: op, ...(s === "next" ? { "stroke-dasharray": ".6 .4" } : {}) }, root);
    if (s !== "on") return;
    for (let k = 6; k < l.cells.length - 1; k += 10) {
      const [x1, y1] = c(l.cells[k - 1]), [x2, y2] = c(l.cells[k + 1]), [x, y] = c(l.cells[k]);
      el("path", { d: "M.45 0 L-.3 -.38 L-.3 .38 Z", fill: acc, transform: `translate(${x} ${y}) rotate(${(Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI})` }, root);
    }
  });
  trip.legs.forEach((l, i) => {
    const [x, y] = c(l.cells.at(-1)), special = l.role !== "stop", s = state(i), r = s === "on" && activeLeg != null ? 0.95 : 0.75;
    el("circle", { cx: x, cy: y, r, fill: special ? css("--ink") : s === "done" ? muted : acc, stroke: css("--floor"), "stroke-width": 0.15, opacity: s === "next" ? 0.6 : 1 }, root);
    el("text", { x, y, "text-anchor": "middle", "dominant-baseline": "central", fill: special ? css("--bg") : css("--accent-ink"), "font-size": 0.8, "font-weight": 700, "font-family": MONO }, root)
      .textContent = l.role === "start" ? "S" : l.role === "end" ? "✓" : s === "done" ? "✓" : i;
  });
}

/** Ghost at the start position, a dashed line, and a pill saying how far it moved. */
function drawDrag(root, { obj: o, sx, sy, text }, W) {
  const v = css;
  el("rect", { x: sx, y: sy, width: o.w, height: o.h, rx: 0.25, fill: "none", stroke: v("--muted"), "stroke-width": 0.1, "stroke-dasharray": ".35 .25" }, root);
  el("line", { x1: sx + o.w / 2, y1: sy + o.h / 2, x2: o.x + o.w / 2, y2: o.y + o.h / 2, stroke: v("--ink"), "stroke-width": 0.1, "stroke-dasharray": ".3 .2" }, root);
  const pw = text.length * 0.48 + 1.2, ph = 1.5;
  const px = Math.max(0, Math.min(W - pw, o.x + o.w / 2 - pw / 2));
  let py = o.y - 2.9; if (py < 0) py = o.y + o.h + 0.8;
  el("rect", { x: px, y: py, width: pw, height: ph, rx: 0.3, fill: v("--ink") }, root);
  el("text", { x: px + pw / 2, y: py + ph / 2, "text-anchor": "middle", "dominant-baseline": "central", fill: v("--bg"), "font-size": 0.8, "font-weight": 700, "font-family": MONO }, root).textContent = text;
}
