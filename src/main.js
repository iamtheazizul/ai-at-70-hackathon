// Entry point: wires the UI modules together, decides which screen to show, and boots the app.
//
// Screens:
//   home        choose Shop or Map a store                      (ui/home.js)
//   shop        store → list → step-by-step trip                (ui/shop.js)
//   contribute  store list → wizard → map editor                (ui/home.js, wizard.js, map2d.js)

import { normalizeImported } from "./core/model.js";
import { generateFromAnswers } from "./core/layout.js";
import { repo } from "./data/repo.js";
import { app, hooks, save, savePrefs, loadPrefs } from "./ui/app.js";
import { $, toast, armed } from "./ui/dom.js";
import { initModal } from "./ui/modal.js";
import { renderHome, renderPicker, setView } from "./ui/home.js";
import { renderSteps, renderWizard, go } from "./ui/wizard.js";
import { renderMap, select, clearForm, initMap2d } from "./ui/map2d.js";
import { setMode, initView3d } from "./ui/view3d.js";
import { renderTrip, initTripPanel } from "./ui/tripPanel.js";
import { renderShop } from "./ui/shop.js";

function show() {
  const v = app.view, S = app.S;
  const contributing = v === "contribute" && !!S;
  const onMap = contributing && S.stage === "map";

  $("#home").hidden = v !== "home";
  $("#picker").hidden = !(v === "contribute" && !S);
  $("#steps").hidden = !contributing;
  $("#wizard").hidden = !contributing || onMap;
  $("#customizer").hidden = !onMap;
  $("#mapActions").hidden = !onMap;
  $("#shop").hidden = v !== "shop";
  $("#modes").hidden = v === "home";
  $("#mShop").setAttribute("aria-pressed", v === "shop");
  $("#mMap").setAttribute("aria-pressed", v === "contribute");
  $("#storeLine").textContent = "";

  if (v === "home") renderHome();
  else if (v === "shop") renderShop();
  else if (!S) renderPicker();
  else {
    renderSteps();
    if (onMap) { renderMap(); renderTrip(); } else renderWizard();
  }
}

Object.assign(hooks, { show, render: renderMap, renderWizard, renderTrip, select });

function bindHeader() {
  $("#brand").onclick = () => setView("home");
  $("#mShop").onclick = () => setView("shop");
  $("#mMap").onclick = () => setView("contribute");
  $("#btnSetup").onclick = () => go("list");
  $("#btnStores").onclick = () => { app.S = null; app.trip = null; savePrefs(); show(); };
  $("#btnRegen").onclick = (e) => armed(e.target, "Regenerate", "Replace your moves?", () => {
    generateFromAnswers(app.S); save(); clearForm(); renderMap(); toast("Layout rebuilt from your answers");
  });
  $("#btnCopy").onclick = () => {
    const t = $("#json"), fallback = () => { t.select(); toast("Press Ctrl/Cmd+C to copy"); };
    try { navigator.clipboard.writeText(t.value).then(() => toast("JSON copied"), fallback); } catch (e) { fallback(); }
  };
  $("#btnImport").onclick = () => {
    try {
      app.S = normalizeImported(JSON.parse($("#json").value));
      if (!app.S.placed || app.S.aisles.some((a) => a.x == null)) generateFromAnswers(app.S);
      app.trip = null; renderTrip(); clearForm(); save(); show();
      toast("Store imported");
    } catch (e) { toast('That isn\'t valid store JSON. It needs an "aisles" list.'); }
  };
}

function watchTheme() {
  const redraw = () => show();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/* ---------- boot ---------- */
const prefs = loadPrefs();
app.view = prefs.view || "home";
app.mode3d = !!prefs.mode3d;
if (prefs.contributeId) app.S = await repo.getStore(prefs.contributeId);
Object.assign(app.shop, prefs.shop || {});

initModal();
initMap2d();
initView3d();
initTripPanel();
bindHeader();
watchTheme();
show();
if (app.mode3d && app.view === "contribute" && app.S?.stage === "map") setMode(true);
