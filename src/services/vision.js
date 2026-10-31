// Photo → aisle categories.
//
// 1. If the server has a model set up, send the photos to POST /api/aisle-categories.
// 2. Otherwise (no server, no key) read the printed text in the browser with OCR.
//
// Resolves to { categories: string[], aisleNo: string | null, source: "model" | "ocr" }.
// Throws an Error with a readable message when something goes wrong.

import { resizeToJpegBlob } from "./image.js";
import { readPhotos } from "./ocr.js";
import { extractFromOcrResults } from "./ocrParse.js";

const ENDPOINT = "/api/aisle-categories";
const MAX_PHOTOS = 6;
const MAX_EDGE = 1600; // px on the long side: enough to read signs, small enough to upload fast

const toJpegBase64 = (file) =>
  resizeToJpegBlob(file, MAX_EDGE).then((blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ mediaType: "image/jpeg", data: String(r.result).split(",")[1] });
    r.onerror = () => reject(new Error("Couldn't read that photo."));
    r.readAsDataURL(blob);
  }));

/** Returns the model's answer, or null when no model is available (offline, static host, no key). */
async function viaModel(files) {
  let res;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ images: await Promise.all(files.map(toJpegBase64)) }) });
  } catch (e) { return null; }
  if (res.status === 404 || res.status === 501) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Something went wrong reading the photos.");
  return { categories: data.categories || [], aisleNo: data.aisleNo || null, source: "model" };
}

export async function suggestCategoriesFromPhotos(files) {
  const photos = files.slice(0, MAX_PHOTOS);
  return (await viaModel(photos)) || { ...extractFromOcrResults(await readPhotos(photos)), source: "ocr" };
}
