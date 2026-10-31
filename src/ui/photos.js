// Photo column in the aisle table: take/upload photos and ask the model for categories.

import { aisleTitle, syncDerived } from "../core/model.js";
import { suggestCategoriesFromPhotos } from "../services/vision.js";
import { save, hooks } from "./app.js";
import { esc, toast } from "./dom.js";
import { openModal, closeModal } from "./modal.js";
import { ICON_CAM } from "./illustrations.js";

// aisle id → [{file, url}]. Kept in memory only, not saved with the store.
export const photos = new Map();
export const photoCount = (id) => (photos.get(id) || []).length;

export function openPhotos(a) {
  const list = () => photos.get(a.id) || [];
  const body = () => `<h3>Fill ${esc(aisleTitle(a))} from photos</h3>
    <p>Take or upload photos of the aisle sign and shelves. The text on them is read and used to fill in the categories.</p>
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
      const msg = sheet.querySelector("#phMsg");
      const reset = () => { e.target.textContent = "Suggest categories"; e.target.disabled = false; };
      let res = null;
      try { res = await suggestCategoriesFromPhotos(list().map((p) => p.file)); }
      catch (err) {
        msg.innerHTML = `<div class="note"><b>Couldn't read the photos.</b> ${esc(err.message || "Try again.")}</div>`;
        reset();
        return;
      }
      const cats = Array.isArray(res) ? res : res.categories || [];
      const aisleNo = Array.isArray(res) ? null : res.aisleNo;
      const have = new Set(a.items.map((x) => x.toLowerCase()));
      const fresh = cats.filter((c) => !have.has(c.toLowerCase()));
      const fillNo = aisleNo && !a.no; // never overwrite a code the contributor typed
      if (!fresh.length && !fillNo) {
        msg.innerHTML = `<div class="note"><b>Nothing new found.</b> ${res.source === "ocr" ? "Text reading only picks up printed words, so try a closer, straight-on photo of the aisle sign." : "Try a closer photo of the aisle sign or the shelf labels."}</div>`;
        reset();
        return;
      }
      a.items = [...a.items, ...fresh];
      if (fillNo) a.no = aisleNo;
      syncDerived(a);
      save();
      closeModal();
      hooks.renderWizard();
      toast(`Added ${fresh.length} ${fresh.length === 1 ? "category" : "categories"}${fillNo ? ` and aisle ${aisleNo}` : ""} from photos${res.source === "ocr" ? ". Check them, text reading can miss or misread words" : ""}`);
    };
  };
  openModal(body(), bind);
}
