// In-browser text reading (Tesseract.js). No API key and no server needed.
// The library, its WebAssembly core and the English language data load from CDNs the
// first time it is used, so that first run needs an internet connection and takes longer.
//
// Each photo is read twice, because one pass rarely gets everything on a sign:
//   "gray"   plain grayscale: dark text on a light background
//   "light"  inverted minimum channel: white text on green, red, blue... (typical aisle sign headers)
// ocrParse.js merges the passes, reads the big aisle number by size, and splits columns by gaps.
//
// Then a third, tiny pass just for the aisle number: OCR is unreliable at even *noticing* a big
// number on a coloured header, so bigGlyph.js finds it by shape and size, and only that cropped
// glyph is read (digits only). See readBigNumber below.

import { scaledCanvas } from "./image.js";
import { wordsFromTsv } from "./ocrParse.js";
import { findBigGlyphs } from "./bigGlyph.js";

const SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js";
const TARGET_EDGE = 2000; // px on the long side
const ANALYSIS_EDGE = 700; // px on the long side, for finding the big number's position (speed over detail)
const GLYPH_HEIGHT = 140; // px: the cropped number is resized to this height before reading
let loading = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { loading = null; reject(new Error("Couldn't load the text reader. It needs an internet connection the first time.")); };
      document.head.append(s);
    });
  }
  return loading;
}

function variant(src, kind) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = kind === "gray" ? 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] : 255 - Math.min(d[i], d[i + 1], d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function wordsOf(data) {
  if (typeof data.tsv === "string" && data.tsv) return wordsFromTsv(data.tsv);
  return (data.words || []).map((w) => ({ text: w.text, conf: w.confidence, left: w.bbox.x0, top: w.bbox.y0, width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0, line: null }));
}

/** Grayscale copy of a canvas (long side <= ANALYSIS_EDGE) for bigGlyph.js, plus the scale used. */
function analysisView(canvas) {
  const k = Math.min(1, ANALYSIS_EDGE / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(canvas.width * k));
  c.height = Math.max(1, Math.round(canvas.height * k));
  const ctx = c.getContext("2d");
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data, gray = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return { width: c.width, height: c.height, gray, k };
}

/** Cut one glyph out of the full-size canvas and redraw it as clean black-on-white with a margin. */
function glyphCrop(base, box, k) {
  const pad = Math.round(0.25 * box.h / k);
  const x = Math.max(0, Math.round(box.x / k) - pad), y = Math.max(0, Math.round(box.y / k) - pad);
  const w = Math.min(base.width - x, Math.round(box.w / k) + 2 * pad), h = Math.min(base.height - y, Math.round(box.h / k) + 2 * pad);
  const src = base.getContext("2d").getImageData(x, y, w, h), d = src.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const mid = (lo + hi) / 2;
  for (let i = 0; i < d.length; i += 4) {
    const ink = box.polarity === "bright" ? d[i] > mid : d[i] < mid;
    d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
    d[i + 3] = 255;
  }
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  tmp.getContext("2d").putImageData(src, 0, 0);
  const scale = GLYPH_HEIGHT / h, margin = 40;
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale) + 2 * margin;
  out.height = GLYPH_HEIGHT + 2 * margin;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tmp, margin, margin, Math.round(w * scale), GLYPH_HEIGHT);
  return out;
}

/**
 * Find the oversized glyph on a photo and read just that, digits only.
 * Resolves to { text, conf } or null. Biggest candidate first; the first confident read wins.
 */
async function readBigNumber(worker, base, modes) {
  const view = analysisView(base);
  const boxes = findBigGlyphs(view);
  if (!boxes.length) return null;
  await worker.setParameters({ tessedit_pageseg_mode: modes.line, tessedit_char_whitelist: "0123456789" });
  let best = null;
  try {
    for (const box of boxes) {
      const { data } = await worker.recognize(glyphCrop(base, box, view.k));
      const text = String(data.text || "").replace(/\D/g, "");
      if (!text || text.length > 2) continue;
      const read = { text, conf: data.confidence };
      if (read.conf >= 60) return read;
      if (!best || read.conf > best.conf) best = read;
    }
    return best;
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: modes.sparse, tessedit_char_whitelist: "" }); // back to normal reading
  }
}

/** Read every photo in both passes, plus the big-number pass. Resolves to [{ text, words, number? }, ...] for ocrParse.extractFromOcrResults. */
export async function readPhotos(files) {
  const T = await loadTesseract();
  const worker = await T.createWorker("eng");
  try {
    const modes = { sparse: (T.PSM && T.PSM.SPARSE_TEXT) || "11", line: (T.PSM && T.PSM.SINGLE_LINE) || "7" };
    await worker.setParameters({ tessedit_pageseg_mode: modes.sparse }); // signs: scattered text, not paragraphs
    const out = [];
    for (const f of files) {
      const base = await scaledCanvas(f, TARGET_EDGE);
      for (const kind of ["gray", "light"]) {
        const { data } = await worker.recognize(variant(base, kind), {}, { text: true, tsv: true });
        out.push({ text: data.text || "", words: wordsOf(data) });
      }
      const number = await readBigNumber(worker, base, modes).catch(() => null); // never let this pass break the rest
      if (number) out.push({ text: "", words: [], number });
    }
    return out;
  } finally {
    await worker.terminate();
  }
}
