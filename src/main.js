// Entry point: wires the UI modules together and boots the app.

import { blankStore, normalizeImported } from "./core/model.js";
import { generateFromAnswers } from "./core/layout.js";
import { app, hooks, loadStore, save, getView } from "./ui/app.js";
import { $, toast, armed } from "./ui/dom.js";
import { initModal } from "./ui/modal.js";
import { renderSteps, renderWizard, go } from "./ui/wizard.js";
import { renderMap, select, clearForm, initMap2d } from "./ui/map2d.js";
import { setMode, initView3d } from "./ui/view3d.js";
import { renderTrip, initTripPanel } from "./ui/tripPanel.js";

function show() {
  const onMap = app.S.stage === "map";
  $("#wizard").hidden = onMap;
  $("#customizer").hidden = !onMap;
  $("#mapActions").hidden = !onMap;
  renderSteps();
  if (onMap) renderMap(); else renderWizard();
}

Object.assign(hooks, { show, render: renderMap, renderWizard, renderTrip, select });

function bindTopActions() {
  $("#btnSetup").onclick = () => go("list");
  $("#btnRegen").onclick = (e) => armed(e.target, "Regenerate", "Replace your moves?", () => {
    generateFromAnswers(app.S); save(); clearForm(); renderMap(); toast("Layout rebuilt from your answers");
  });
  $("#btnNew").onclick = (e) => armed(e.target, "New store", "Start over?", () => {
    app.S = blankStore(); app.sel = null; app.trip = null; renderTrip(); save(); show();
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
  const redraw = () => (app.S.stage === "map" ? renderMap() : renderWizard());
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

// boot
app.S = loadStore() || blankStore();
initModal();
initMap2d();
initView3d();
initTripPanel();
bindTopActions();
watchTheme();
save();
show();
if (app.S.stage === "map" && getView() === "3d") setMode(true);
