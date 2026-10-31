// App state, persistence, and cross-module hooks.
// UI modules read and write `app`; `hooks` lets them call each other without import cycles.

import { STORAGE_KEY } from "../core/constants.js";
import { planTrip } from "../routing/tripPlanner.js";

export const app = {
  S: null,        // the store being edited
  sel: null,      // selected aisle id on the map
  trip: null,     // current planned route (see routing/tripPlanner.js)
  tripText: "",   // shopping list that produced it
  mode3d: false,
};

// Filled in by main.js.
export const hooks = {
  show() {}, render() {}, renderWizard() {}, renderTrip() {}, select() {},
};

export function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && Array.isArray(s.aisles)) return s;
  } catch (e) { /* storage blocked or empty */ }
  return null;
}

export const getView = () => { try { return localStorage.getItem(STORAGE_KEY + ":view"); } catch (e) { return null; } };
export const setView = (v) => { try { localStorage.setItem(STORAGE_KEY + ":view", v); } catch (e) { /* ignore */ } };

/** Persist the store, refresh the JSON box, and re-plan an open route against the new layout. */
export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(app.S)); } catch (e) { /* storage blocked */ }
  const json = document.querySelector("#json");
  if (json) json.value = JSON.stringify(app.S, null, 1);
  if (app.trip && app.S.stage === "map") {
    const t = planTrip(app.S, app.tripText);
    if (!t.error) app.trip = t;
    hooks.renderTrip();
  }
}

export const markDirty = () => { if (app.S.placed) app.S.dirty = true; };
