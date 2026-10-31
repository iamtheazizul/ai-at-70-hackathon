// Contributor flow: store → how many → aisle table → neighbours per aisle → map.

import { STAGES, PTS, PT_NAME, SPECIAL, FLOWS, FLOWS_FOR } from "../core/constants.js";
import { cap, parseItems, newAisle, syncDerived, aisleTitle, shortLabel, nbLabel, byId, setNb, setAisleCount, rowProblem, incompleteRows, setOrient, setFlow } from "../core/model.js";
import { exampleStore } from "../core/example.js";
import { generateFromAnswers } from "../core/layout.js";
import { app, hooks, save, markDirty } from "./app.js";
import { $, esc, toast } from "./dom.js";
import { openModal, closeModal } from "./modal.js";
import { ICON_H, ICON_V, ICON_CAM, ICON_FLOW, orientIllus, sidesIllus } from "./illustrations.js";
import { openPhotos, photoCount } from "./photos.js";

/* ---------- navigation ---------- */
export function go(stage, cur) {
  const S = app.S;
  S.stage = stage;
  if (cur != null) S.cur = cur;
  S.reached = Math.max(S.reached || 0, STAGES.findIndex((s) => s[0] === stage));
  save();
  hooks.show();
  window.scrollTo(0, 0);
}

export function renderSteps() {
  const S = app.S, idx = STAGES.findIndex((s) => s[0] === S.stage);
  $("#steps").innerHTML = STAGES.map(([k, l], i) =>
    `<button data-s="${k}" ${i === idx ? 'aria-current="step"' : ""} class="${i < idx || (i <= S.reached && i !== idx) ? "done" : ""}" ${i > Math.max(S.reached, idx) ? "disabled" : ""}><span class="n">${i + 1}</span>${l}</button>`).join("");
  $("#steps").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    if (b.dataset.s === "map") {
      if (!S.placed) generateFromAnswers(S);
      else if (S.dirty) toast("Your answers changed. Press Regenerate to rebuild the layout.");
    }
    go(b.dataset.s);
  }));
  $("#storeLine").textContent = [S.name, S.address].filter(Boolean).join(" · ");
}

export function renderWizard() {
  if (!app.S) return;
  ({ address: stepAddress, count: stepCount, list: stepList, nb: stepNeighbors })[app.S.stage]?.();
}

const finishToMap = () => {
  generateFromAnswers(app.S);
  go("map");
  toast("Map generated from your answers. Drag anything to adjust it.");
};

/* ---------- 1. store ---------- */
function stepAddress() {
  const S = app.S;
  $("#wizard").innerHTML = `<section class="card">
    <h2>Which store are you mapping?</h2>
    <p class="lede">The address keeps each store's map separate, so shoppers find the right one.</p>
    <label>Store name<input id="wName" value="${esc(S.name)}" placeholder="e.g. Hillside Co-op"></label>
    <label>Street address<input id="wAddr" value="${esc(S.address)}" placeholder="123 Main St, Springfield, ST 00000" autocomplete="street-address"></label>
    <p class="err" id="wErr" hidden>Add the store's address to continue.</p>
    <div class="nav"><button class="ghost" id="wEx">Try it with an example store</button><div class="r"><button class="primary" id="wNext">Next</button></div></div>
  </section>`;
  $("#wNext").onclick = () => {
    S.name = $("#wName").value.trim();
    S.address = $("#wAddr").value.trim();
    if (!S.address) { $("#wErr").hidden = false; $("#wAddr").focus(); return; }
    go("count");
  };
  $("#wEx").onclick = () => {
    app.S = exampleStore();
    $("#tripList").value = "milk\npeanut butter\nbananas\nchips\nbread";
    save();
    hooks.show();
    toast("Example store loaded. Step through it or jump to Map.");
  };
}

/* ---------- 2. how many ---------- */
function stepCount() {
  const S = app.S;
  $("#wizard").innerHTML = `<section class="card">
    <h2>How many aisles are in this store?</h2>
    <p class="lede">Count every place shoppers walk to, including sections without a number like Produce, Bakery or the Deli.</p>
    <div class="counter"><button id="cMinus" aria-label="One fewer">−</button><input id="cNum" type="number" min="1" max="80" inputmode="numeric" value="${S.count || ""}" placeholder="0" aria-label="Number of aisles"><button id="cPlus" aria-label="One more">+</button></div>
    <p class="err" id="wErr" hidden>Enter at least 1 aisle.</p>
    <div class="nav"><button class="ghost" id="wBack">Back</button><div class="r"><button class="primary" id="wNext">Next</button></div></div>
  </section>`;
  const n = $("#cNum");
  $("#cMinus").onclick = () => (n.value = Math.max(1, (+n.value || 1) - 1));
  $("#cPlus").onclick = () => (n.value = Math.min(80, (+n.value || 0) + 1));
  $("#wBack").onclick = () => go("address");
  $("#wNext").onclick = () => {
    const c = Math.round(+n.value);
    if (!(c >= 1)) { $("#wErr").hidden = false; return; }
    setAisleCount(S, Math.min(80, c));
    go("list");
  };
}

/* ---------- 3. aisle table ---------- */
export function showOrientInfo() {
  openModal(`<h3>How to pick orientation</h3>
  <p>Stand at the store entrance and face into the store. Decide every aisle's orientation from that one spot, so all contributors describe the store the same way.</p>
  <div class="illus">${orientIllus()}</div>
  <p><b style="color:var(--ink)">Vertical</b>: the aisle runs away from you, toward the back wall. <b style="color:var(--ink)">Horizontal</b>: it runs across your view, from left to right.</p>
  <div class="nav" style="border:0;padding:0"><span></span><button class="primary" data-close>Got it</button></div>`);
}

export function showSidesInfo() {
  openModal(`<h3>Walking direction and sides</h3>
  <p>Pick the direction you'd walk the aisle, starting at the end where its first shelves are. Then imagine walking it that way: whatever is on your left hand goes in <b style="color:var(--ink)">Left side</b>, your right hand in <b style="color:var(--ink)">Right side</b>. List each side in the order you pass things.</p>
  <div class="flowgrid">${Object.keys(FLOWS).map((f) => `<div class="flowopt">${sidesIllus(f)}<b>${FLOWS[f][0]}</b><small>${FLOWS[f][1]}</small></div>`).join("")}</div>
  <p>Vertical aisles walk closest → furthest or furthest → closest. Horizontal aisles walk left → right or right → left.</p>
  <div class="nav" style="border:0;padding:0"><span></span><button class="primary" data-close>Got it</button></div>`);
}

function rowHtml(a, i) {
  const fits = a.orient ? FLOWS_FOR[a.orient] : [];
  const flowCtl = !a.no ? "" : `<div class="fld"><span class="lbl">Walk direction</span>
      ${a.orient ? `<div class="orient" role="radiogroup" aria-label="Walk direction, row ${i + 1}">${fits.map((f) => `<button data-flow="${f}" aria-pressed="${a.flow === f}" title="${FLOWS[f][0]}">${ICON_FLOW[f]}</button>`).join("")}</div>`
        : '<span class="hint">Pick orientation first</span>'}</div>`;
  const cats = a.no
    ? `<label>Left side<input data-f="left" value="${esc(a.left.join(", "))}" placeholder="In the order you pass them"></label>
       <label>Right side<input data-f="right" value="${esc(a.right.join(", "))}" placeholder="In the order you pass them"></label>`
    : `<label class="full">Categories<input data-f="items" value="${esc(a.items.join(", "))}" placeholder="${i === 0 ? "Produce, fruit, herbs" : "Bakery, bread, cakes"}"></label>`;
  return `<div class="rw" data-i="${i}">
    <div class="r1">
      <label class="fld code">Code<input data-f="no" value="${esc(a.no)}" placeholder="7, A1 or blank" maxlength="5"></label>
      <div class="fld"><span class="lbl">Orientation</span><div class="orient" role="radiogroup" aria-label="Orientation, row ${i + 1}">
        <button data-o="h" aria-pressed="${a.orient === "h"}" title="Horizontal: runs left to right">${ICON_H}</button>
        <button data-o="v" aria-pressed="${a.orient === "v"}" title="Vertical: runs away from you">${ICON_V}</button></div></div>
      ${flowCtl}
      <div class="fld ph"><span class="lbl">Photo</span><button class="phbtn" data-photo="${i}" title="Add photos to fill in categories" aria-label="Photos for row ${i + 1}">${ICON_CAM}${photoCount(a.id) ? `<span class="badge">${photoCount(a.id)}</span>` : ""}</button></div>
    </div>
    <div class="r2">${cats}</div>
    <p class="err rowerr" hidden></p>
  </div>`;
}

function stepList() {
  const S = app.S;
  $("#wizard").innerHTML = `<section class="card">
    <h2>Describe each aisle</h2>
    <p class="lede">Leave the code blank for sections without one, like Produce or Bakery. For numbered aisles, choose the walk direction, then list what's on each side.
      <span class="infos"><button class="linkish" id="oInfo">How orientation works</button> · <button class="linkish" id="sInfo">How sides work</button></span></p>
    <div class="rows" id="rows">${S.aisles.map(rowHtml).join("")}</div>
    <p class="err" id="wErr" hidden></p>
    <div class="nav"><button class="ghost" id="wBack">Back</button><div class="r"><button class="ghost" id="wAdd">Add a row</button><button class="primary" id="wNext">Next: neighbors</button></div></div>
  </section>`;

  const rerow = (i, focusField) => {
    const old = $(`#rows .rw[data-i="${i}"]`);
    old.outerHTML = rowHtml(S.aisles[i], i);
    if (focusField) {
      const inp = $(`#rows .rw[data-i="${i}"] [data-f="${focusField}"]`);
      if (inp) { inp.focus(); inp.setSelectionRange?.(inp.value.length, inp.value.length); }
    }
  };

  $("#oInfo").onclick = showOrientInfo;
  $("#sInfo").onclick = showSidesInfo;
  $("#rows").addEventListener("input", (e) => {
    const r = e.target.closest(".rw"); if (!r) return;
    const i = +r.dataset.i, a = S.aisles[i], f = e.target.dataset.f;
    if (f === "no") {
      const wasAisle = !!a.no;
      a.no = e.target.value.trim();
      syncDerived(a);
      if (wasAisle !== !!a.no) rerow(i, "no"); // aisle ↔ section: different fields
    } else {
      a[f] = parseItems(e.target.value);
      syncDerived(a);
    }
    r.classList.remove("bad");
    markDirty();
    save();
  });
  $("#rows").addEventListener("click", (e) => {
    const r = e.target.closest(".rw"); if (!r) return;
    const i = +r.dataset.i, a = S.aisles[i];
    const ph = e.target.closest("[data-photo]");
    if (ph) { openPhotos(a); return; }
    const o = e.target.closest("[data-o]"), fl = e.target.closest("[data-flow]");
    if (o) setOrient(a, o.dataset.o);
    else if (fl) setFlow(a, fl.dataset.flow); // reversing swaps the left/right lists
    else return;
    syncDerived(a);
    markDirty();
    save();
    rerow(i);
  });
  $("#wBack").onclick = () => go("count");
  $("#wAdd").onclick = () => {
    S.aisles.push(newAisle()); S.count = S.aisles.length; save(); stepList();
    $("#rows").lastElementChild.querySelector("input").focus();
  };
  $("#wNext").onclick = () => {
    const bad = incompleteRows(S);
    document.querySelectorAll(".rw").forEach((r) => {
      const problem = rowProblem(S.aisles[+r.dataset.i]), msg = r.querySelector(".rowerr");
      r.classList.toggle("bad", !!problem);
      msg.hidden = !problem;
      msg.textContent = problem;
    });
    if (bad.length) {
      const e = $("#wErr"); e.hidden = false;
      e.textContent = `${bad.length} row${bad.length > 1 ? "s need" : " needs"} attention.`;
      document.querySelector(".rw.bad")?.scrollIntoView({ block: "center" });
      return;
    }
    S.aisles.forEach(syncDerived);
    go("nb", 0);
  };
}

/* ---------- 4. neighbours, one aisle per screen ---------- */
function neighborSvg(a) {
  const S = app.S, vert = a.orient !== "h", bw = vert ? 56 : 230, bh = vert ? 190 : 56, cx = 270, cy = 205;
  const L = cx - bw / 2, R = cx + bw / 2, T = cy - bh / 2, B = cy + bh / 2;
  const P = { nw: [L, T], n: [cx, T], ne: [R, T], e: [R, cy], se: [R, B], s: [cx, B], sw: [L, B], w: [L, cy] };
  const O = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
  let out = `<svg id="nb" viewBox="0 0 540 410" role="group" aria-label="Eight points around ${esc(aisleTitle(a))}">
  <text x="270" y="22" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--muted)" letter-spacing="1">↑ BACK OF STORE</text>
  <text x="270" y="400" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--muted)" letter-spacing="1">ENTRANCE SIDE · YOU ARE HERE ↓</text>
  <text x="12" y="${cy + 4}" font-family="var(--mono)" font-size="11" fill="var(--muted)">LEFT</text>
  <text x="528" y="${cy + 4}" text-anchor="end" font-family="var(--mono)" font-size="11" fill="var(--muted)">RIGHT</text>
  <rect x="${L}" y="${T}" width="${bw}" height="${bh}" rx="6" fill="${a.color}"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="var(--body)" font-weight="700" font-size="15" ${vert ? `transform="rotate(-90 ${cx} ${cy})"` : ""}>${esc(a.no ? `Aisle ${a.no}` : cap(a.items[0] || "Section"))}</text>`;
  PTS.forEach((p) => {
    const [px, py] = P[p], [ox, oy] = O[p], v = a.nb[p];
    if (v) {
      const lab = nbLabel(S, v), t = lab.length > 15 ? lab.slice(0, 14) + "…" : lab, w = t.length * 7.4 + 20, h = 26;
      const ax = px + ox * 20, ay = py + oy * 28;
      const x = ox < 0 ? ax - w : ox > 0 ? ax : ax - w / 2, y = oy === 0 ? ay - h / 2 : oy < 0 ? ay - h : ay;
      const b = byId(S, v);
      const fill = b ? b.color : v === "entrance" ? "var(--accent)" : v === "open" ? "var(--panel)" : "var(--muted)";
      const ink = v === "open" ? "var(--ink)" : "#fff";
      out += `<g class="pt" data-p="${p}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${fill}" ${v === "open" ? 'stroke="var(--muted)" stroke-dasharray="4 3"' : ""}/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" fill="${ink}" font-family="var(--body)" font-weight="700" font-size="12">${esc(t)}</text></g>`;
    }
    out += `<g class="pt" data-p="${p}" tabindex="0" role="button" aria-label="${PT_NAME[p]}: ${esc(nbLabel(S, v) || "not set")}">
      <circle cx="${px}" cy="${py}" r="20" fill="transparent"/>
      <circle class="ring" cx="${px}" cy="${py}" r="12" fill="${v ? "var(--accent)" : "var(--panel)"}" stroke="var(--accent)" stroke-width="2.5"/>
      <text x="${px}" y="${py + 1}" text-anchor="middle" dominant-baseline="central" font-family="var(--mono)" font-weight="700" font-size="14" fill="${v ? "var(--accent-ink)" : "var(--accent)"}">${v ? "✓" : "+"}</text></g>`;
  });
  return out + "</svg>";
}

function stepNeighbors() {
  const S = app.S, i = Math.min(S.cur || 0, S.aisles.length - 1), a = S.aisles[i], last = i === S.aisles.length - 1;
  $("#wizard").innerHTML = `<section class="card">
    <div class="jump" aria-label="Jump to aisle">${S.aisles.map((x, j) => `<button data-j="${j}" class="${Object.keys(x.nb).length ? "has" : ""}" ${j === i ? 'aria-current="true"' : ""} title="${esc(shortLabel(x))}">${esc(x.no || cap(x.items[0] || "?").slice(0, 4))}</button>`).join("")}</div>
    <div><p class="hint" style="margin:0 0 4px">${i + 1} of ${S.aisles.length}</p><h2>What's next to ${esc(aisleTitle(a))}?</h2></div>
    <p class="lede">Tap a point and pick what sits right beside it at that spot. The top of the box faces the back of the store, the bottom faces the entrance. Some points may already be filled in from earlier answers.</p>
    <div class="nbgrid">
      <div class="nbstage">${neighborSvg(a)}</div>
      <ul class="ptlist">${PTS.map((p) => `<li><button data-p="${p}"><b>${PT_NAME[p]}</b><span class="${a.nb[p] ? "" : "empty"}">${esc(nbLabel(S, a.nb[p]) || "Not set")}</span></button></li>`).join("")}</ul>
    </div>
    <div class="nav"><button class="ghost" id="wBack">${i === 0 ? "Back to aisle list" : "Previous aisle"}</button>
      <div class="r">${last ? "" : '<button class="ghost" id="wSkip">Skip to map</button>'}<button class="primary" id="wNext">${last ? "Generate map" : "Next aisle"}</button></div></div>
  </section>`;

  $("#wizard").querySelectorAll("[data-p]").forEach((g) => {
    g.onclick = () => openPicker(a, g.dataset.p);
    g.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(a, g.dataset.p); } };
  });
  $("#wizard").querySelectorAll("[data-j]").forEach((b) => (b.onclick = () => go("nb", +b.dataset.j)));
  $("#wBack").onclick = () => (i === 0 ? go("list") : go("nb", i - 1));
  $("#wNext").onclick = () => (last ? finishToMap() : go("nb", i + 1));
  if ($("#wSkip")) $("#wSkip").onclick = finishToMap;
}

function openPicker(a, p) {
  const S = app.S, cur = a.nb[p], usedHere = new Set(Object.values(a.nb)), others = S.aisles.filter((x) => x.id !== a.id);
  const swatch = (k) => (k === "entrance" ? "var(--accent)" : k === "open" ? "transparent;border:1px dashed var(--muted)" : "var(--muted)");
  openModal(`<h3>${PT_NAME[p]} of ${esc(aisleTitle(a))}</h3>
    <p>What sits right next to this point?</p>
    <input id="pf" placeholder="Filter aisles" aria-label="Filter aisles" autofocus>
    <div class="choices">
      <h4>Store features</h4>
      ${Object.entries(SPECIAL).map(([k, l]) => `<button class="choice" data-v="${k}" aria-pressed="${cur === k}"><span class="sw" style="background:${swatch(k)}"></span>${l}</button>`).join("")}
      <h4>Aisles</h4>
      ${others.map((x) => `<button class="choice" data-v="${x.id}" data-t="${esc((x.no + " " + x.items.join(" ")).toLowerCase())}" aria-pressed="${cur === x.id}"><span class="sw" style="background:${x.color}"></span><span class="code">${esc(x.no || "–")}</span>${esc(x.items.slice(0, 3).map(cap).join(", ") || "No categories")}${usedHere.has(x.id) && cur !== x.id ? '<span class="used">already at another point</span>' : ""}</button>`).join("")}
    </div>
    <div class="nav" style="padding-top:12px">${cur ? '<button class="danger ghost" data-v="">Clear this point</button>' : "<span></span>"}<button class="ghost" data-close>Cancel</button></div>`,
  (sheet) => {
    sheet.querySelector("#pf").oninput = (e) => {
      const q = e.target.value.toLowerCase();
      sheet.querySelectorAll("[data-t]").forEach((b) => (b.hidden = q && !b.dataset.t.includes(q)));
    };
    sheet.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => {
      setNb(S, a, p, b.dataset.v || null);
      save(); closeModal(); stepNeighbors();
    }));
  });
}
