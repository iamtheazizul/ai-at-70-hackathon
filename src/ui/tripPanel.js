// "Test a trip" panel in the map editor: lets contributors check routes while they adjust the map.

import { planTrip, nodeName, placeText } from "../routing/tripPlanner.js";
import { app, hooks } from "./app.js";
import { $, esc, toast } from "./dom.js";

const FT_PER_MIN = 264; // ~3 mph walking pace

export function runTrip(text) {
  const result = planTrip(app.S, text);
  if (result.error) { toast(result.error); return; }
  app.trip = result;
  app.tripText = text;
  renderTrip();
  hooks.render();
  const n = result.stopIds.size;
  toast(`Route found: ${result.total} ft, ${n} stop${n === 1 ? "" : "s"}`);
}

export function renderTrip() {
  const trip = app.trip, out = $("#tripOut");
  $("#btnTripClear").hidden = !trip;
  if (!trip || !app.S) { out.innerHTML = ""; return; }
  const S = app.S, n = trip.legs.filter((l) => l.role === "stop").length;
  out.innerHTML = `<div class="tripsum"><b>${trip.total} ft</b><span>${n} stop${n === 1 ? "" : "s"} · about ${Math.max(1, Math.round(trip.total / FT_PER_MIN))} min walking · entrance to checkout</span></div>
  <ol class="legs">${trip.legs.map((l, i) => `<li class="leg"><span class="bd ${l.role !== "stop" ? "s" : ""}">${l.role === "start" ? "S" : l.role === "end" ? "✓" : i}</span><div style="min-width:0">
    <h4>${l.role === "start" ? "Start at the entrance" : esc(placeText(S, l))}${l.dist ? `<small>${l.dist} ft</small>` : ""}</h4>
    ${l.dirs.length ? `<ul class="dirs">${l.dirs.map((d) => `<li>${d}</li>`).join("")}</ul>` : ""}
    ${l.via.length ? `<div class="via">Passing ${l.via.map((v) => esc(nodeName(S, v))).join(", ")}</div>` : ""}
    ${l.products.length ? `<div class="pick">Pick up ${l.products.map((p) => `<b>${esc(p.product)}</b>${p.type !== "exact" && p.item ? ` <em>(${esc(p.item)})</em>` : ""}`).join(", ")}</div>` : ""}
  </div></li>`).join("")}</ol>
  ${trip.unmatched.length ? `<div class="miss">${trip.unmatched.map((u) => `<div><b>Not found:</b> ${esc(u.product)}${u.suggestions.length ? ` · did you mean ${u.suggestions.map(esc).join(", ")}?` : ""}</div>`).join("")}</div>` : ""}`;
}

export function initTripPanel() {
  $("#btnTrip").onclick = () => runTrip($("#tripList").value);
  $("#btnTripClear").onclick = () => { app.trip = null; renderTrip(); hooks.render(); };
}
