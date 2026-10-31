// App state, persistence, and cross-module hooks.
// UI modules read and write `app`; `hooks` lets them call each other without import cycles.

import { repo } from "../data/repo.js";
import { planTrip } from "../routing/tripPlanner.js";

const PREFS_KEY = "aisle-mapper-ui";

export const app = {
  view: "home",   // "home" | "contribute" | "shop"
  // contributor
  S: null,        // the store being mapped (null = choosing a store)
  sel: null,      // selected aisle id on the map
  trip: null,     // test route in the map editor
  tripText: "",
  mode3d: false,
  // shopper
  shop: { stage: "store", storeId: null, S: null, list: [], trip: null, step: 0, got: [] },
};

// Filled in by main.js.
export const hooks = {
  show() {}, render() {}, renderWizard() {}, renderTrip() {}, select() {},
};

/* ---------- small per-browser preferences (which screen, shopping list…) ---------- */
export function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
}
export function savePrefs() {
  const { stage, storeId, list, step, got } = app.shop;
  const prefs = { view: app.view, contributeId: app.S?.id || null, mode3d: app.mode3d, shop: { stage, storeId, list, step, got } };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* storage blocked */ }
}

/** Persist the store being mapped, refresh the JSON box, and re-plan an open test route. */
export function save() {
  if (!app.S) return;
  repo.saveStore(app.S);
  savePrefs();
  const json = document.querySelector("#json");
  if (json) json.value = JSON.stringify(app.S, null, 1);
  if (app.trip && app.S.stage === "map") {
    const t = planTrip(app.S, app.tripText);
    if (!t.error) app.trip = t;
    hooks.renderTrip();
  }
}

export const markDirty = () => { if (app.S.placed) app.S.dirty = true; };
