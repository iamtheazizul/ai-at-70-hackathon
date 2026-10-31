// One reusable modal sheet.

import { $ } from "./dom.js";
import { app, hooks } from "./app.js";

let lastFocus = null;

export function openModal(html, bind) {
  lastFocus = document.activeElement;
  $("#sheet").innerHTML = html;
  $("#modal").hidden = false;
  bind && bind($("#sheet"));
  ($("#sheet").querySelector("[autofocus]") || $("#sheet").querySelector("button"))?.focus();
}

export function closeModal() {
  $("#modal").hidden = true;
  $("#sheet").innerHTML = "";
  if (app.S.stage === "list") hooks.renderWizard(); // refresh photo badges etc.
  lastFocus?.focus?.();
}

export function initModal() {
  $("#modal").addEventListener("click", (e) => {
    if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
}
