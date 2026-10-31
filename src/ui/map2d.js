// 2D floor plan editor: selection, edit form, shape inspector, dragging with a live distance readout.
// The drawing itself is in planRenderer.js.

import { DEPTS, PTS, PT_NAME, FLOWS, FT_PER_CELL } from "../core/constants.js";
import { dimsOf, byId, newAisle, parseItems, nbLabel, removeAisle, shelfFt, itemMatches, isAisle, effectiveFlow, syncDerived } from "../core/model.js";
import { app, save } from "./app.js";
import { $, esc, fmt, toast, armed } from "./dom.js";
import { drawPlan } from "./planRenderer.js";
import { build3d } from "./view3d.js";

let drag = null; // {obj, dx, dy, sx, sy, moved}
const query = () => $("#q").value.trim().toLowerCase();

function moveText(o) {
  const dx = o.x - drag.sx, dy = o.y - drag.sy, parts = [];
  if (dx) parts.push(`${fmt(Math.abs(dx * FT_PER_CELL))} ft ${dx > 0 ? "right" : "left"}`);
  if (dy) parts.push(`${fmt(Math.abs(dy * FT_PER_CELL))} ft ${dy > 0 ? "toward entrance" : "toward back"}`);
  return { txt: parts.join(" · ") || "Back at start", squares: `${fmt(Math.abs(dx))} × ${fmt(Math.abs(dy))} squares` };
}

/* ---------- drawing + panels ---------- */
export function renderMap() {
  const S = app.S;
  if (!S || S.stage !== "map") return;
  const q = query();
  let dragInfo = null;
  if (drag?.moved) {
    const { txt, squares } = moveText(drag.obj);
    dragInfo = { obj: drag.obj, sx: drag.sx, sy: drag.sy, text: txt };
    $("#dragRead").hidden = false;
    $("#dragRead").textContent = `Moving ${drag.obj.name || "block"}: ${txt} (${squares})`;
  } else $("#dragRead").hidden = true;

  const hits = drawPlan($("#map"), S, { editable: true, q, sel: app.sel, trip: app.trip, drag: dragInfo });
  if (app.mode3d) build3d(q);
  $("#hit").innerHTML = q ? (hits ? `<b>${hits}</b> aisle${hits > 1 ? "s" : ""} match` : "No aisle lists that item") : "";
  renderList();
  renderLegend();
  renderDetail(q);
}

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
    '<span class="hint">· 1 grid square = 2 ft · aisles show both shelves and the walking direction</span>';
}

function renderDetail(q) {
  const S = app.S, box = $("#detail"), a = byId(S, app.sel);
  if (!a) { box.innerHTML = '<h2>Aisle details</h2><div class="hint">Select an aisle on the map or in the list to see its shelves and edit it.</div>'; return; }
  const chips = (list) => list.map((i) => `<span class="chip${itemMatches({ items: [i] }, q).length ? " match" : ""}">${esc(i)}</span>`).join("") || '<span class="hint">Nothing listed</span>';
  const nbs = PTS.filter((p) => a.nb?.[p]).map((p) => `${PT_NAME[p]}: ${esc(nbLabel(S, a.nb[p]))}`).join(" · ");
  box.innerHTML = `<h2>${isAisle(a) ? "Aisle " + esc(a.no) : "Section"} · ${esc(a.dept)}${isAisle(a) ? " · walk " + FLOWS[effectiveFlow(a)][0].toLowerCase() : ""}</h2>
    <div style="font:800 20px var(--display)">${esc(a.name)}</div>
    ${isAisle(a)
      ? `<div class="sides"><div><b>Left side</b><div class="chips">${chips(a.left)}</div></div><div><b>Right side</b><div class="chips">${chips(a.right)}</div></div></div>`
      : `<div class="chips">${chips(a.items)}</div>`}
    ${nbs ? `<div class="hint">Neighbors you entered: ${nbs}</div>` : ""}`;
}

/* ---------- selection + edit form ---------- */
function showFieldsFor(kind) {
  $("#fSidesWrap").hidden = kind !== "aisle";
  $("#fItemsWrap").hidden = kind === "aisle";
}

export function select(id) {
  app.sel = id || null;
  const a = byId(app.S, app.sel);
  if (a) {
    $("#formTitle").textContent = a.no ? `Edit aisle ${a.no}` : `Edit ${a.name}`;
    $("#fSubmit").textContent = "Save changes";
    $("#fCancel").hidden = $("#fDelete").hidden = false;
    $("#inspector").hidden = false;
    $("#fNo").value = a.no; $("#fName").value = a.name; $("#fKind").value = a.kind; $("#fDept").value = a.dept;
    $("#fItems").value = a.items.join(", "); $("#fLeft").value = (a.left || []).join(", "); $("#fRight").value = (a.right || []).join(", ");
    showFieldsFor(a.kind);
    $("#iW").value = a.w * FT_PER_CELL; $("#iH").value = a.h * FT_PER_CELL; $("#iZ").value = shelfFt(a); $("#iC").value = a.color || DEPTS[a.dept];
  } else clearForm();
  renderMap();
}

export function clearForm() {
  app.sel = null;
  $("#form").reset();
  showFieldsFor($("#fKind").value);
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
  $("#fKind").onchange = (e) => showFieldsFor(e.target.value);
  $("#form").onsubmit = (e) => {
    e.preventDefault();
    const S = app.S, { W, H } = dimsOf(S);
    const kind = $("#fKind").value;
    const data = { no: $("#fNo").value.trim(), name: $("#fName").value.trim(), dept: $("#fDept").value };
    if (kind === "aisle") Object.assign(data, { left: parseItems($("#fLeft").value), right: parseItems($("#fRight").value) });
    else data.items = parseItems($("#fItems").value);
    if (kind === "aisle" && !data.no) { toast("An aisle needs a code. Choose Section for areas like Produce."); return; }
    const a = current();
    if (a) {
      if (a.dept !== data.dept) { a.color = DEPTS[data.dept]; a.customDept = true; }
      if (a.name !== data.name) a.customName = true;
      Object.assign(a, data);
      if (kind !== "aisle") a.no = "";
      syncDerived(a);
      toast(`Saved ${a.name}`);
    } else {
      const b = { ...newAisle(), ...data, color: DEPTS[data.dept], customName: true, customDept: true, orient: kind === "aisle" ? "v" : "h" };
      if (kind !== "aisle") b.no = "";
      syncDerived(b);
      Object.assign(b, kind === "aisle" ? { x: W / 2, y: Math.min(7, H - 16), w: 5, h: 15 } : { x: W / 2 - 6, y: H / 2 - 1.5, w: 12, h: 3 });
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
    if (a.flow) a.flow = null; // the old walking direction no longer fits; the default for the new orientation applies
    clamp(a);
    $("#iW").value = a.w * FT_PER_CELL; $("#iH").value = a.h * FT_PER_CELL;
    save(); renderMap();
  };
}

/* ---------- dragging + keyboard ---------- */
function bindDrag() {
  const root = $("#map");
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
