// 2D floor plan editor: drawing, selection, edit form, dragging with a live distance readout.

import { DEPTS, PTS, PT_NAME, FLOWS, FT_PER_CELL } from "../core/constants.js";
import { dimsOf, byId, newAisle, parseItems, nbLabel, removeAisle, shelfFt, itemMatches, isHit } from "../core/model.js";
import { RES } from "../routing/floorGrid.js";
import { app, save } from "./app.js";
import { $, esc, css, fmt, fit, toast, armed } from "./dom.js";
import { build3d } from "./view3d.js";

const NS = "http://www.w3.org/2000/svg";
const svg = () => $("#map");
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent && parent.appendChild(e);
  return e;
}

let drag = null; // {obj, dx, dy, sx, sy, moved}

const query = () => $("#q").value.trim().toLowerCase();

function moveText(o) {
  const dx = o.x - drag.sx, dy = o.y - drag.sy, parts = [];
  if (dx) parts.push(`${fmt(Math.abs(dx * FT_PER_CELL))} ft ${dx > 0 ? "right" : "left"}`);
  if (dy) parts.push(`${fmt(Math.abs(dy * FT_PER_CELL))} ft ${dy > 0 ? "toward entrance" : "toward back"}`);
  return { txt: parts.join(" · ") || "Back at start", squares: `${fmt(Math.abs(dx))} × ${fmt(Math.abs(dy))} squares` };
}

/* ---------- drawing ---------- */
export function renderMap() {
  const S = app.S;
  if (S.stage !== "map") return;
  const { W, H } = dimsOf(S), q = query(), v = css, root = svg();
  root.setAttribute("viewBox", `-1 -1 ${W + 2} ${H + 2}`);
  root.innerHTML = "";
  const mono = "JetBrains Mono, monospace", body = "Atkinson Hyperlegible, sans-serif";

  // floor, grid, scale
  el("rect", { x: 0, y: 0, width: W, height: H, fill: v("--floor"), stroke: v("--ink"), "stroke-width": 0.25 }, root);
  const g = el("g", { stroke: v("--grid"), "stroke-width": 0.05 }, root);
  for (let x = 1; x < W; x++) el("line", { x1: x, y1: 0, x2: x, y2: H }, g);
  for (let y = 1; y < H; y++) el("line", { x1: 0, y1: y, x2: W, y2: y }, g);
  el("line", { x1: 1, y1: H - 0.6, x2: 6, y2: H - 0.6, stroke: v("--muted"), "stroke-width": 0.12 }, root);
  el("text", { x: 1, y: H - 1, fill: v("--muted"), "font-size": 0.7, "font-family": mono }, root).textContent = "10 ft";
  el("text", { x: W / 2, y: -0.25, "text-anchor": "middle", fill: v("--muted"), "font-size": 0.6, "font-family": mono }, root).textContent = "BACK OF STORE";

  // entrance and checkout
  (S.fixtures || []).forEach((f) => {
    if (f.kind === "door") {
      el("rect", { x: f.x, y: H - 0.35, width: f.w, height: 0.7, fill: v("--floor") }, root);
      el("path", { d: `M${f.x + f.w / 2} ${H - 1.6} l-.7 .7 m.7 -.7 l.7 .7 m-.7 -.7 v1.5`, stroke: v("--accent"), "stroke-width": 0.18, fill: "none" }, root);
      el("text", { x: f.x + f.w / 2, y: H - 2, "text-anchor": "middle", fill: v("--accent"), "font-size": 0.75, "font-weight": 700, "font-family": mono }, root).textContent = "ENTRANCE";
      return;
    }
    const gg = el("g", { class: "blk", "data-fx": f.id }, root);
    el("rect", { x: f.x, y: f.y, width: f.w, height: f.h, rx: 0.3, fill: v("--floor"), stroke: v("--muted"), "stroke-width": 0.12, "stroke-dasharray": ".4 .3" }, gg);
    for (let i = 1; i < Math.floor(f.w / 3); i++) el("rect", { x: f.x + i * 3 - 0.5, y: f.y + 0.4, width: 1, height: Math.max(0.2, f.h - 0.8), fill: v("--line") }, gg);
    el("text", { x: f.x + f.w / 2, y: f.y - 0.35, "text-anchor": "middle", fill: v("--muted"), "font-size": 0.7, "font-family": mono }, gg).textContent = f.name.toUpperCase();
  });

  // aisles
  let hits = 0;
  S.aisles.forEach((a) => {
    if (a.x == null) return;
    const hit = isHit(a, q);
    if (hit) hits++;
    const gg = el("g", { class: "blk" + (q && !hit ? " dim" : ""), "data-id": a.id, tabindex: 0, role: "button", "aria-label": `${a.no ? "Aisle " + a.no + ", " : ""}${a.name}` }, root);
    const vert = a.h > a.w;
    el("rect", { x: a.x, y: a.y, width: a.w, height: a.h, rx: 0.25, fill: a.color || DEPTS[a.dept] || DEPTS.Other }, gg);
    if (hit && q) el("rect", { x: a.x - 0.35, y: a.y - 0.35, width: a.w + 0.7, height: a.h + 0.7, rx: 0.45, fill: "none", stroke: v("--tag"), "stroke-width": 0.3 }, gg);
    if (app.sel === a.id) el("rect", { x: a.x - 0.3, y: a.y - 0.3, width: a.w + 0.6, height: a.h + 0.6, rx: 0.4, fill: "none", stroke: v("--ink"), "stroke-width": 0.15, "stroke-dasharray": ".5 .3" }, gg);
    if (app.trip?.stopIds.has(a.id)) el("rect", { x: a.x - 0.25, y: a.y - 0.25, width: a.w + 0.5, height: a.h + 0.5, rx: 0.4, fill: "none", stroke: v("--accent"), "stroke-width": 0.22 }, gg);

    // flow arrow near the end the aisle runs toward
    if (a.flow) {
      const s = Math.min(0.9, Math.min(a.w, a.h) * 0.6), ang = { cf: -90, fc: 90, lr: 0, rl: 180 }[a.flow];
      const px = { cf: a.x + a.w / 2, fc: a.x + a.w / 2, lr: a.x + a.w - Math.min(1.2, a.w * 0.15), rl: a.x + Math.min(1.2, a.w * 0.15) }[a.flow];
      const py = { cf: a.y + Math.min(1.2, a.h * 0.15), fc: a.y + a.h - Math.min(1.2, a.h * 0.15), lr: a.y + a.h / 2, rl: a.y + a.h / 2 }[a.flow];
      el("path", { d: `M${s / 2} 0 L${-s / 2} ${-s / 2} L${-s / 2} ${s / 2} Z`, fill: "#fff", opacity: 0.9, transform: `translate(${px} ${py}) rotate(${ang})` }, gg);
    }
    // shelf-tag with the code, at the end the aisle starts from
    let tw = 0;
    if (a.no) {
      tw = Math.max(1.6, String(a.no).length * 0.75 + 0.6);
      let tx, ty;
      if (vert) { tx = a.x + a.w / 2 - tw / 2; ty = a.flow === "cf" ? a.y + a.h + 0.2 : a.y - 1.7; }
      else { tx = a.flow === "rl" ? a.x + a.w - tw - 0.3 : a.x + 0.3; ty = a.y + a.h / 2 - 0.75; }
      el("rect", { x: tx, y: ty, width: tw, height: 1.5, rx: 0.2, fill: v("--tag") }, gg);
      el("text", { x: tx + tw / 2, y: ty + 1.12, "text-anchor": "middle", fill: v("--tag-ink"), "font-size": 1.05, "font-weight": 700, "font-family": mono }, gg).textContent = a.no;
    }
    if (vert) {
      const fs = Math.min(0.75, a.w * 0.5);
      el("text", { x: a.x + a.w / 2, y: a.y + a.h / 2, "text-anchor": "middle", "dominant-baseline": "central", fill: "#fff", "font-size": fs, "font-weight": 700, "font-family": body, transform: `rotate(-90 ${a.x + a.w / 2} ${a.y + a.h / 2})` }, gg).textContent = fit(a.name, (a.h - 2.4) / (fs * 0.55));
    } else {
      const fs = Math.min(0.8, a.h * 0.4), inside = a.no ? tw + 0.3 : 0, shift = a.flow === "rl" ? -inside / 2 : inside / 2;
      el("text", { x: a.x + a.w / 2 + shift, y: a.y + a.h / 2, "text-anchor": "middle", "dominant-baseline": "central", fill: "#fff", "font-size": fs, "font-weight": 700, "font-family": body }, gg).textContent = fit(a.name, (a.w - inside - 2.2) / (fs * 0.55));
    }
  });

  drawTrip(root);
  drawDragInfo(root, W);

  if (app.mode3d) build3d(q);
  $("#hit").innerHTML = q ? (hits ? `<b>${hits}</b> aisle${hits > 1 ? "s" : ""} match` : "No aisle lists that item") : "";
  renderList();
  renderLegend();
  renderDetail(q);
}

function drawTrip(root) {
  const trip = app.trip;
  if (!trip) return;
  const c = ([x, y]) => [(x + 0.5) * RES, (y + 0.5) * RES], acc = css("--accent");
  trip.legs.forEach((l) => {
    if (l.cells.length < 2) return;
    const points = l.cells.map((p) => c(p).join(",")).join(" ");
    el("polyline", { points, fill: "none", stroke: css("--floor"), "stroke-width": 0.55, "stroke-linejoin": "round", "stroke-linecap": "round" }, root);
    el("polyline", { points, fill: "none", stroke: acc, "stroke-width": 0.3, "stroke-linejoin": "round", "stroke-linecap": "round" }, root);
    for (let k = 6; k < l.cells.length - 1; k += 10) {
      const [x1, y1] = c(l.cells[k - 1]), [x2, y2] = c(l.cells[k + 1]), [x, y] = c(l.cells[k]);
      el("path", { d: "M.45 0 L-.3 -.38 L-.3 .38 Z", fill: acc, transform: `translate(${x} ${y}) rotate(${(Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI})` }, root);
    }
  });
  trip.legs.forEach((l, i) => {
    const [x, y] = c(l.cells.at(-1)), special = l.role !== "stop";
    el("circle", { cx: x, cy: y, r: 0.75, fill: special ? css("--ink") : acc, stroke: css("--floor"), "stroke-width": 0.15 }, root);
    el("text", { x, y, "text-anchor": "middle", "dominant-baseline": "central", fill: special ? css("--bg") : css("--accent-ink"), "font-size": 0.8, "font-weight": 700, "font-family": "JetBrains Mono, monospace" }, root).textContent = l.role === "start" ? "S" : l.role === "end" ? "✓" : i;
  });
}

function drawDragInfo(root, W) {
  const read = $("#dragRead");
  if (!drag || !drag.moved) { read.hidden = true; return; }
  const o = drag.obj, { txt, squares } = moveText(o), v = css;
  el("rect", { x: drag.sx, y: drag.sy, width: o.w, height: o.h, rx: 0.25, fill: "none", stroke: v("--muted"), "stroke-width": 0.1, "stroke-dasharray": ".35 .25" }, root);
  el("line", { x1: drag.sx + o.w / 2, y1: drag.sy + o.h / 2, x2: o.x + o.w / 2, y2: o.y + o.h / 2, stroke: v("--ink"), "stroke-width": 0.1, "stroke-dasharray": ".3 .2" }, root);
  const pw = txt.length * 0.48 + 1.2, ph = 1.5;
  const px = Math.max(0, Math.min(W - pw, o.x + o.w / 2 - pw / 2));
  let py = o.y - 2.9; if (py < 0) py = o.y + o.h + 0.8;
  el("rect", { x: px, y: py, width: pw, height: ph, rx: 0.3, fill: v("--ink") }, root);
  el("text", { x: px + pw / 2, y: py + ph / 2, "text-anchor": "middle", "dominant-baseline": "central", fill: v("--bg"), "font-size": 0.8, "font-weight": 700, "font-family": "JetBrains Mono, monospace" }, root).textContent = txt;
  read.hidden = false;
  read.textContent = `Moving ${o.name || "block"}: ${txt} (${squares})`;
}

/* ---------- side panel ---------- */
function renderList() {
  const S = app.S, list = $("#list");
  list.innerHTML = "";
  const sorted = [...S.aisles].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "wall" ? 1 : -1) || (parseFloat(a.no) || 0) - (parseFloat(b.no) || 0));
  if (!sorted.length) list.innerHTML = '<div class="hint">No aisles yet. Add one above.</div>';
  sorted.forEach((a) => {
    const d = document.createElement("div");
    d.className = "item" + (app.sel === a.id ? " sel" : "");
    d.tabIndex = 0;
    d.innerHTML = `<span class="no" style="background:${a.color || DEPTS[a.dept]}"></span><div style="min-width:0"><div class="nm"></div><small></small></div><span class="ct">${a.items.length}</span>`;
    d.querySelector(".no").textContent = a.no || "·";
    d.querySelector(".nm").textContent = a.name;
    d.querySelector("small").textContent = a.items.join(", ") || "No items yet";
    d.onclick = () => select(a.id);
    d.onkeydown = (e) => { if (e.key === "Enter") select(a.id); };
    list.appendChild(d);
  });
  $("#count").textContent = `· ${S.aisles.length}`;
}

function renderLegend() {
  const used = [...new Set(app.S.aisles.map((a) => a.dept))];
  $("#legend").innerHTML = used.map((d) => `<span><i style="background:${DEPTS[d] || DEPTS.Other}"></i>${esc(d)}</span>`).join("") +
    '<span class="hint">· 1 grid square = 2 ft · ▸ shows which way an aisle flows</span>';
}

function renderDetail(q) {
  const S = app.S, box = $("#detail"), a = byId(S, app.sel);
  if (!a) { box.innerHTML = '<h2>Aisle details</h2><div class="hint">Select an aisle on the map or in the list to see its shelves and edit it.</div>'; return; }
  const nbs = PTS.filter((p) => a.nb?.[p]).map((p) => `${PT_NAME[p]}: ${esc(nbLabel(S, a.nb[p]))}`).join(" · ");
  box.innerHTML = `<h2>${a.kind === "wall" ? "Section" : "Aisle " + esc(a.no)} · ${esc(a.dept)}${a.flow ? " · flows " + FLOWS[a.flow][0].toLowerCase() : ""}</h2>
    <div style="font:800 20px var(--display)">${esc(a.name)}</div>
    <div class="chips">${a.items.map((i) => `<span class="chip${itemMatches({ items: [i] }, q).length ? " match" : ""}">${esc(i)}</span>`).join("") || '<span class="hint">No items listed</span>'}</div>
    ${nbs ? `<div class="hint">Neighbors you entered: ${nbs}</div>` : ""}`;
}

/* ---------- selection + edit form ---------- */
export function select(id) {
  app.sel = id || null;
  const a = byId(app.S, app.sel);
  if (a) {
    $("#formTitle").textContent = a.no ? `Edit aisle ${a.no}` : `Edit ${a.name}`;
    $("#fSubmit").textContent = "Save changes";
    $("#fCancel").hidden = $("#fDelete").hidden = false;
    $("#inspector").hidden = false;
    $("#fNo").value = a.no; $("#fName").value = a.name; $("#fKind").value = a.kind; $("#fDept").value = a.dept; $("#fItems").value = a.items.join(", ");
    $("#iW").value = a.w * FT_PER_CELL; $("#iH").value = a.h * FT_PER_CELL; $("#iZ").value = shelfFt(a); $("#iC").value = a.color || DEPTS[a.dept];
  } else clearForm();
  renderMap();
}

export function clearForm() {
  app.sel = null;
  $("#form").reset();
  $("#formTitle").textContent = "Add an aisle";
  $("#fSubmit").textContent = "Add aisle";
  $("#fCancel").hidden = $("#fDelete").hidden = true;
  $("#inspector").hidden = true;
}

const current = () => byId(app.S, app.sel);
function clamp(o) {
  const { W, H } = dimsOf(app.S);
  o.x = Math.max(0, Math.min(W - o.w, o.x));
  o.y = Math.max(0, Math.min(H - o.h, o.y));
}

function bindForm() {
  $("#fDept").innerHTML = Object.keys(DEPTS).map((d) => `<option>${d}</option>`).join("");
  $("#form").onsubmit = (e) => {
    e.preventDefault();
    const S = app.S, { W, H } = dimsOf(S);
    const data = { no: $("#fNo").value.trim(), name: $("#fName").value.trim(), kind: $("#fKind").value, dept: $("#fDept").value, items: parseItems($("#fItems").value) };
    const a = current();
    if (a) {
      if (a.dept !== data.dept) { a.color = DEPTS[data.dept]; a.customDept = true; }
      if (a.name !== data.name) a.customName = true;
      Object.assign(a, data);
      toast(`Saved ${a.name}`);
    } else {
      const b = { ...newAisle(), ...data, color: DEPTS[data.dept], customName: true, customDept: true, orient: data.kind === "wall" ? "h" : "v" };
      Object.assign(b, data.kind === "wall" ? { x: W / 2 - 4, y: H / 2 - 1, w: 8, h: 3 } : { x: W / 2, y: Math.min(7, H - 16), w: 1.5, h: 15 });
      S.aisles.push(b);
      S.count = S.aisles.length;
      app.sel = null;
      toast(`Added ${b.name}. Drag it into place.`);
    }
    save();
    select(app.sel);
  };
  $("#fCancel").onclick = () => { clearForm(); renderMap(); };
  $("#fDelete").onclick = (e) => armed(e.target, "Delete", "Click again to delete", () => {
    removeAisle(app.S, app.sel);
    clearForm(); save(); renderMap(); toast("Aisle deleted");
  });

  // shape inspector
  const onNum = (sel, fn) => ($(sel).oninput = (e) => { const a = current(); if (a && +e.target.value > 0) { fn(a, +e.target.value); save(); renderMap(); } });
  onNum("#iW", (a, v) => (a.w = v / FT_PER_CELL));
  onNum("#iH", (a, v) => (a.h = v / FT_PER_CELL));
  onNum("#iZ", (a, v) => (a.ht = v));
  $("#iC").oninput = (e) => { const a = current(); if (a) { a.color = e.target.value; a.customColor = true; save(); renderMap(); } };
  $("#iRot").onclick = () => {
    const a = current(); if (!a) return;
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    [a.w, a.h] = [a.h, a.w];
    a.x = cx - a.w / 2; a.y = cy - a.h / 2;
    a.orient = a.h > a.w ? "v" : "h";
    clamp(a);
    $("#iW").value = a.w * FT_PER_CELL; $("#iH").value = a.h * FT_PER_CELL;
    save(); renderMap();
  };
}

/* ---------- dragging + keyboard ---------- */
function bindDrag() {
  const root = svg();
  const pt = (e) => { const p = root.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(root.getScreenCTM().inverse()); };

  root.addEventListener("pointerdown", (e) => {
    const g = e.target.closest(".blk"); if (!g) return;
    const obj = g.dataset.id ? byId(app.S, g.dataset.id) : (app.S.fixtures || []).find((f) => f.id === g.dataset.fx);
    if (!obj) return;
    if (g.dataset.id && app.sel !== obj.id) select(obj.id);
    const p = pt(e);
    drag = { obj, dx: p.x - obj.x, dy: p.y - obj.y, sx: obj.x, sy: obj.y, moved: false };
    root.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = pt(e);
    let x = p.x - drag.dx, y = p.y - drag.dy;
    if ($("#snap").checked) { x = Math.round(x * 2) / 2; y = Math.round(y * 2) / 2; }
    if (x === drag.obj.x && y === drag.obj.y && drag.moved) return;
    drag.obj.x = x; drag.obj.y = y;
    clamp(drag.obj);
    drag.moved = true;
    renderMap();
  });
  const end = () => {
    if (drag && drag.moved) { const { txt } = moveText(drag.obj); drag = null; save(); toast(`Moved ${txt}`); }
    drag = null;
    renderMap();
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);

  root.addEventListener("keydown", (e) => {
    const g = e.target.closest(".blk"); if (!g || !g.dataset.id) return;
    if (e.key === "Enter") { select(g.dataset.id); return; }
    const a = byId(app.S, g.dataset.id);
    const d = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
    if (!a || !d) return;
    e.preventDefault();
    a.x += d[0]; a.y += d[1];
    clamp(a);
    app.sel = a.id;
    save(); renderMap();
    toast(`Moved 1 ft ${{ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "toward back", ArrowDown: "toward entrance" }[e.key]}`);
    root.querySelector(`[data-id="${a.id}"]`)?.focus();
  });
}

export function initMap2d() {
  bindForm();
  bindDrag();
  $("#q").oninput = renderMap;
}
