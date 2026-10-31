// Shopper mode: pick a store → build a shopping list (checked live against the store) → step-by-step trip.

import { generateFromAnswers } from "../core/layout.js";
import { exampleStore } from "../core/example.js";
import { cap } from "../core/model.js";
import { repo } from "../data/repo.js";
import { buildItemIndex, matchProduct } from "../routing/matching.js";
import { planTrip, nodeName, placeText } from "../routing/tripPlanner.js";
import { app, hooks, savePrefs } from "./app.js";
import { $, esc, toast } from "./dom.js";
import { drawPlan } from "./planRenderer.js";

const FT_PER_MIN = 264; // ~3 mph walking pace
const sh = () => app.shop;

function goStage(stage) {
  sh().stage = stage;
  savePrefs();
  renderShop();
  window.scrollTo(0, 0);
}

/** Load the chosen store; returns false if it's gone or has no map yet. */
export async function loadShopStore() {
  const s = sh();
  if (!s.storeId) return false;
  const S = await repo.getStore(s.storeId);
  if (!S || !S.placed) { s.storeId = null; s.S = null; return false; }
  s.S = S;
  return true;
}

export async function renderShop() {
  const s = sh();
  if (s.stage !== "store" && !s.S && !(await loadShopStore())) s.stage = "store";
  $("#storeLine").textContent = s.stage === "store" ? "" : [s.S?.name, s.S?.address].filter(Boolean).join(" · ");
  if (s.stage === "store") return renderStorePick();
  if (s.stage === "list") return renderList();
  return renderTripView();
}

/* ---------- 1. choose a store ---------- */
async function renderStorePick() {
  const stores = (await repo.listStores()).filter((x) => x.placed);
  $("#shop").innerHTML = `<section class="card narrow">
    <h2>Where are you shopping?</h2>
    ${stores.length
      ? `<ul class="stores">${stores.map((x) => `<li><button class="storepick" data-id="${esc(x.id)}"><b>${esc(x.name)}</b><span>${esc(x.address || "")} · ${x.aisleCount} aisles and sections</span></button></li>`).join("")}</ul>`
      : `<p class="lede">No stores have a map yet. Load the example store to try it, or map a store yourself.</p>
         <div class="toolbar"><button class="primary" id="shEx">Load the example store</button><button class="ghost" id="shMap">Map a store</button></div>`}
  </section>`;
  $("#shop").querySelectorAll("[data-id]").forEach((b) => (b.onclick = async () => {
    sh().storeId = b.dataset.id; sh().S = null; sh().trip = null; sh().step = 0; sh().got = [];
    await loadShopStore();
    goStage("list");
  }));
  if ($("#shEx")) $("#shEx").onclick = async () => {
    const S = generateFromAnswers(exampleStore());
    S.stage = "map"; S.reached = 4;
    await repo.saveStore(S);
    sh().storeId = S.id; sh().S = S;
    if (!sh().list.length) sh().list = ["milk", "peanut butter", "bananas", "chips", "bread", "honey"];
    goStage("list");
  };
  if ($("#shMap")) $("#shMap").onclick = () => { app.view = "contribute"; savePrefs(); hooks.show(); };
}

/* ---------- 2. shopping list ---------- */
function describeMatch(S, index, product) {
  const m = matchProduct(index, product);
  if (!m.candidates.length) return { ok: false, text: "Not in this store", suggestions: m.suggestions };
  const c = m.candidates[0], a = S.aisles.find((x) => x.id === c.section);
  const where = c.side ? `${a.no ? "Aisle " + a.no : cap(a.name)} · ${c.side} side` : nodeName(S, c.section);
  const also = new Set(m.candidates.map((x) => x.section)).size > 1 ? " (and elsewhere)" : "";
  return { ok: true, fuzzy: m.type === "fuzzy", text: m.type === "exact" ? where + also : `${where} · as “${c.item}”${also}`, suggestions: [] };
}

function renderList() {
  const s = sh(), S = s.S, index = buildItemIndex(S.aisles);
  const allItems = [...new Set(S.aisles.flatMap((a) => a.items))].sort();
  const found = s.list.filter((p) => describeMatch(S, index, p).ok).length;
  $("#shop").innerHTML = `<section class="card narrow">
    <div class="titlerow"><h2>Your shopping list</h2><button class="linkish" id="shStore">Change store</button></div>
    <form id="addForm" class="addrow">
      <input id="addItem" list="storeItems" placeholder="Add an item, e.g. peanut butter" aria-label="Add an item" autocomplete="off">
      <datalist id="storeItems">${allItems.map((i) => `<option value="${esc(i)}">`).join("")}</datalist>
      <button class="primary" type="submit">Add</button>
    </form>
    ${s.list.length ? `<ul class="shoplist">${s.list.map((p, i) => {
      const d = describeMatch(S, index, p);
      return `<li class="${d.ok ? "" : "missing"}"><span class="dot" aria-hidden="true">${d.ok ? "✓" : "?"}</span>
        <div style="min-width:0"><b>${esc(p)}</b><span>${esc(d.text)}${d.suggestions.length ? ` · did you mean ${d.suggestions.map((x) => `<button class="linkish" data-fix="${i}" data-to="${esc(x)}">${esc(x)}</button>`).join(", ")}?` : ""}</span></div>
        <button class="ghost xbtn" data-rm="${i}" aria-label="Remove ${esc(p)}">✕</button></li>`;
    }).join("")}</ul>` : '<p class="hint">Your list is empty. Add what you need and we’ll find the shortest way through the store.</p>'}
    <div class="nav">${s.list.length ? '<button class="ghost danger" id="shClear">Clear list</button>' : "<span></span>"}
      <div class="r"><span class="hint">${s.list.length ? `${found} of ${s.list.length} found in this store` : ""}</span><button class="primary" id="shGo" ${found ? "" : "disabled"}>Find my route</button></div></div>
  </section>`;

  $("#addForm").onsubmit = (e) => {
    e.preventDefault();
    const v = $("#addItem").value.trim();
    if (!v) return;
    const parts = v.split(",").map((x) => x.trim()).filter(Boolean);
    s.list.push(...parts.filter((p) => !s.list.some((x) => x.toLowerCase() === p.toLowerCase())));
    savePrefs(); renderList();
    $("#addItem").focus();
  };
  $("#shStore").onclick = () => goStage("store");
  if ($("#shClear")) $("#shClear").onclick = () => { s.list = []; s.got = []; savePrefs(); renderList(); };
  $("#shop").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { s.list.splice(+b.dataset.rm, 1); savePrefs(); renderList(); }));
  $("#shop").querySelectorAll("[data-fix]").forEach((b) => (b.onclick = () => { s.list[+b.dataset.fix] = b.dataset.to; savePrefs(); renderList(); }));
  $("#shGo").onclick = () => {
    const t = planTrip(S, s.list);
    if (t.error) { toast(t.error); return; }
    s.trip = t; s.step = 0; s.got = [];
    goStage("trip");
  };
}

/* ---------- 3. the trip, one stop at a time ---------- */
function renderTripView() {
  const s = sh(), S = s.S;
  if (!s.trip) {
    const t = planTrip(S, s.list);
    if (t.error) { toast(t.error); return goStage("list"); }
    s.trip = t;
  }
  const t = s.trip, legs = t.legs, i = Math.min(s.step, legs.length - 1), leg = legs[i];
  const stops = legs.filter((l) => l.role === "stop").length;
  const minutes = Math.max(1, Math.round(t.total / FT_PER_MIN));
  const itemsTotal = legs.reduce((n, l) => n + l.products.length, 0);

  let body;
  if (leg.role === "start") {
    body = `<p class="eyebrow">Ready</p><h3>Start at the entrance</h3>
      <p>${stops} stop${stops === 1 ? "" : "s"} · ${t.total} ft · about ${minutes} min of walking. The route ends at checkout.</p>
      ${t.unmatched.length ? `<p class="hint">Not in this store: ${t.unmatched.map((u) => esc(u.product)).join(", ")}</p>` : ""}`;
  } else if (leg.role === "end") {
    const got = s.got.length;
    body = `<p class="eyebrow">Last step · ${leg.dist} ft</p><h3>Head to checkout</h3>
      ${dirs(leg)}
      <p>You checked off ${got} of ${itemsTotal} item${itemsTotal === 1 ? "" : "s"}.</p>`;
  } else {
    body = `<p class="eyebrow">Stop ${i} of ${stops} · ${leg.dist} ft</p><h3>${esc(placeText(S, leg))}</h3>
      ${dirs(leg)}
      ${leg.via.length ? `<p class="via">Passing ${leg.via.map((v) => esc(nodeName(S, v))).join(", ")}</p>` : ""}
      <ul class="picks">${leg.products.map((p) => `<li><label><input type="checkbox" data-got="${esc(p.product)}" ${s.got.includes(p.product) ? "checked" : ""}> <b>${esc(p.product)}</b>${p.type !== "exact" && p.item ? ` <em>(${esc(p.item)})</em>` : ""}</label></li>`).join("")}</ul>`;
  }

  $("#shop").innerHTML = `<div class="tripgrid">
    <div class="tripside">
      <section class="card stepcard">${body}
        <div class="nav">${i > 0 ? '<button class="ghost" id="stPrev">Back</button>' : '<button class="ghost" id="stList">Edit list</button>'}
          <div class="r"><button class="primary" id="stNext">${leg.role === "start" ? "Start" : leg.role === "end" ? "Finish" : i === legs.length - 2 ? "Go to checkout" : "Next stop"}</button></div></div>
      </section>
      <ol class="overview">${legs.map((l, k) => `<li><button data-step="${k}" class="${k === i ? "now" : k < i ? "done" : ""}">
        <span class="bd">${l.role === "start" ? "S" : l.role === "end" ? "✓" : k}</span>
        <span class="ov-t">${esc(l.role === "start" ? "Entrance" : l.role === "end" ? "Checkout" : placeText(S, l))}</span>
        <span class="ov-p">${esc(l.products.map((p) => p.product).join(", "))}</span></button></li>`).join("")}</ol>
    </div>
    <div class="canvas"><svg id="shopMap" aria-label="Store map with your route"></svg></div>
  </div>`;

  drawPlan($("#shopMap"), S, { trip: t, activeLeg: i });

  const to = (k) => { s.step = Math.max(0, Math.min(legs.length - 1, k)); savePrefs(); renderTripView(); };
  $("#stNext").onclick = () => {
    if (leg.role === "end") { toast("Trip finished. Enjoy!"); s.trip = null; s.step = 0; return goStage("list"); }
    to(i + 1);
  };
  if ($("#stPrev")) $("#stPrev").onclick = () => to(i - 1);
  if ($("#stList")) $("#stList").onclick = () => { s.trip = null; goStage("list"); };
  $("#shop").querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => to(+b.dataset.step)));
  $("#shop").querySelectorAll("[data-got]").forEach((c) => (c.onchange = () => {
    const p = c.dataset.got;
    s.got = c.checked ? [...new Set([...s.got, p])] : s.got.filter((x) => x !== p);
    savePrefs();
  }));
}

const dirs = (leg) => (leg.dirs.length ? `<ul class="dirs">${leg.dirs.map((d) => `<li>${d}</li>`).join("")}</ul>` : "");
