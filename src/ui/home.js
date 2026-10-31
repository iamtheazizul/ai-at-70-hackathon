// Start screen (shop or map) and the contributor's list of stores.

import { blankStore } from "../core/model.js";
import { STAGES } from "../core/constants.js";
import { repo } from "../data/repo.js";
import { app, hooks, save, savePrefs } from "./app.js";
import { $, esc, toast, armed } from "./dom.js";
import { photos } from "./photos.js";

const ICON_CART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/></svg>';
const ICON_PLAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v12M13 3v12M18 3v12M3 19h18"/></svg>';

export function setView(view) {
  app.view = view;
  savePrefs();
  hooks.show();
  window.scrollTo(0, 0);
}

export function renderHome() {
  $("#home").innerHTML = `
    <p class="lede home-lede">Find everything on your list in one walk through the store, or help map a store so others can.</p>
    <div class="roles">
      <button class="role" id="goShop">${ICON_CART}<b>Shop</b><span>Pick a store, write your list, and get the shortest route from the entrance to checkout.</span></button>
      <button class="role" id="goMap">${ICON_PLAN}<b>Map a store</b><span>Describe a store's aisles and what's on each shelf. The map is generated from your answers.</span></button>
    </div>`;
  $("#goShop").onclick = () => setView("shop");
  $("#goMap").onclick = () => setView("contribute");
}

/** Contributor: choose a store to keep mapping, or start a new one. */
export async function renderPicker() {
  const stores = await repo.listStores();
  const stageName = (s) => (s.placed ? "Map ready" : `In progress · ${STAGES.find((x) => x[0] === s.stage)?.[1] || "Store"}`);
  $("#picker").innerHTML = `<section class="card">
    <h2>Your stores</h2>
    <p class="lede">Pick up where you left off, or start mapping a new store.</p>
    ${stores.length ? `<ul class="stores">${stores.map((s) => `<li class="storerow">
        <div style="min-width:0"><b>${esc(s.name)}</b><span>${esc(s.address || "No address yet")}</span></div>
        <span class="pill ${s.placed ? "ok" : ""}">${stageName(s)}</span>
        <div class="r"><button class="danger ghost" data-del="${esc(s.id)}">Delete</button><button data-open="${esc(s.id)}">Continue</button></div>
      </li>`).join("")}</ul>` : '<p class="hint">No stores yet.</p>'}
    <div class="nav"><button class="ghost" id="pkHome">Back</button><div class="r"><button class="primary" id="pkNew">Map a new store</button></div></div>
  </section>`;
  $("#pkHome").onclick = () => setView("home");
  $("#pkNew").onclick = () => {
    // a new store starts empty: drop everything the previous store left in memory
    app.S = blankStore(); app.sel = null; app.trip = null; app.tripText = "";
    for (const list of photos.values()) list.forEach((p) => URL.revokeObjectURL(p.url));
    photos.clear();
    const tripList = $("#tripList"); if (tripList) tripList.value = "";
    save(); hooks.show();
  };
  $("#picker").querySelectorAll("[data-open]").forEach((b) => (b.onclick = async () => {
    app.S = await repo.getStore(b.dataset.open);
    app.sel = null; app.trip = null;
    savePrefs();
    hooks.show();
  }));
  $("#picker").querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => armed(b, "Delete", "Click again", async () => {
    await repo.deleteStore(b.dataset.del);
    toast("Store deleted");
    renderPicker();
  })));
}
