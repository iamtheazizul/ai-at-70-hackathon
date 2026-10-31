// Photo column in the aisle table: take/upload photos and ask the model for categories.

import { aisleTitle, syncDerived } from "../core/model.js";
import { suggestCategoriesFromPhotos } from "../services/vision.js";
import { save } from "./app.js";
import { esc, toast } from "./dom.js";
import { openModal, closeModal } from "./modal.js";
import { ICON_CAM } from "./illustrations.js";

// aisle id → [{file, url}]. Kept in memory only, not saved with the store.
export const photos = new Map();
export const photoCount = (id) => (photos.get(id) || []).length;

export function openPhotos(a) {
  const list = () => photos.get(a.id) || [];
  const body = () => `<h3>Fill ${esc(aisleTitle(a))} from photos</h3>
    <p>Take or upload photos of the aisle sign and shelves. A model will read them and fill in the categories.</p>
    <label class="drop" style="position:relative">${ICON_CAM.replace("<svg", '<svg width="34" height="34" style="color:var(--accent)"')}
      <b style="color:var(--ink);font-size:14px">Take photo or choose images</b>
      <span>On a phone this opens the camera</span>
      <input type="file" id="phIn" accept="image/*" capture="environment" multiple></label>
    ${list().length ? `<div class="phgrid">${list().map((p, k) => `<img src="${p.url}" alt="Aisle photo ${k + 1}">`).join("")}</div>` : ""}
    <div id="phMsg"></div>
    <div class="nav" style="padding-top:12px">${list().length ? '<button class="danger ghost" id="phClear">Remove photos</button>' : "<span></span>"}
      <div class="r"><button class="ghost" data-close>Close</button><button class="primary" id="phGo" ${list().length ? "" : "disabled"}>Suggest categories</button></div></div>`;

  const bind = (sheet) => {
    const rerender = () => { sheet.innerHTML = body(); bind(sheet); };
    sheet.querySelector("#phIn").onchange = (e) => {
      const added = [...e.target.files].map((file) => ({ file, url: URL.createObjectURL(file) }));
      photos.set(a.id, [...list(), ...added]);
      rerender();
    };
    const clear = sheet.querySelector("#phClear");
    if (clear) clear.onclick = () => { list().forEach((p) => URL.revokeObjectURL(p.url)); photos.delete(a.id); rerender(); };
    sheet.querySelector("#phGo").onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Reading photos…";
      let cats = null;
      try { cats = await suggestCategoriesFromPhotos(list().map((p) => p.file)); } catch (err) { /* treat as not connected */ }
      if (!cats) {
        sheet.querySelector("#phMsg").innerHTML = '<div class="note"><b>Model not connected yet.</b> The photos are attached to this row for now. Type the categories in the table, and they will fill in automatically once the model is hooked up.</div>';
        e.target.textContent = "Suggest categories";
        e.target.disabled = false;
        return;
      }
      a.items = [...new Set([...a.items, ...cats])];
      syncDerived(a);
      save();
      closeModal();
      toast(`Added ${cats.length} categories from photos`);
    };
  };
  openModal(body(), bind);
}
