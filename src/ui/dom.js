// Small DOM helpers shared by the UI modules.

export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const fit = (s, max) => { max = Math.floor(max); return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…"; };

export function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("on"), 2200);
}

/** Two-click confirm for destructive buttons (the page can't use confirm()). */
export function armed(btn, label, armedLabel, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; fn(); return; }
  btn.dataset.armed = 1;
  btn.textContent = armedLabel;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 2800);
}
