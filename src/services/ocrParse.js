// Turns OCR output from an aisle sign / shelf photo into categories and an aisle number.
// Pure functions: runs in the browser, in Node, and in tests.
//
// OCR results look like { text?: string, words?: [{ text, conf, left, top, width, height, line }], number?: { text, conf } }.
// Word boxes let us find the big aisle number by size and split two-column signs by gaps.
// `number` is the digits-only read of the big glyph that bigGlyph.js located (see ocr.js).

import { KEYWORDS } from "../core/constants.js";
import { cleanCategories, cleanAisleNo } from "./visionParse.js";

const KNOWN = new Set(Object.values(KEYWORDS).flat());
const STOP = new Set(["aisle", "sale", "save", "price", "each", "new", "now", "only", "limited", "time", "buy", "get", "free", "per", "with", "the", "and", "for", "from", "our", "your", "see", "more", "item", "items", "sign", "open", "hours", "store", "cart", "member", "members", "coupon", "deal", "deals", "oz", "lb", "lbs"]);
const isKnown = (w) => KNOWN.has(w) || (w.endsWith("s") && KNOWN.has(w.slice(0, -1)));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Parse Tesseract TSV output into word records (level 5 rows with text). */
export function wordsFromTsv(tsv) {
  const words = [];
  for (const row of String(tsv ?? "").split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5" || !c[11].trim()) continue;
    words.push({ text: c[11].trim(), conf: parseFloat(c[10]), left: +c[6], top: +c[7], width: +c[8], height: +c[9], line: `${c[2]}-${c[3]}-${c[4]}` });
  }
  return words;
}

/** The aisle number is the tallest 1–2 digit word, much bigger than the category text. Votes across passes. */
function bigNumber(resultsWords) {
  const votes = new Map();
  for (const words of resultsWords) {
    const ref = median(words.filter((w) => w.conf >= 80 && /^[A-Za-z]{3,}$/.test(w.text)).map((w) => w.height));
    for (const w of words) {
      const m = w.text.match(/^(\d{1,2})$/);
      if (!m || w.conf < 30 || +m[1] < 1) continue;
      if (ref ? w.height < 1.6 * ref : w.conf < 60) continue;
      votes.set(m[1], (votes.get(m[1]) || 0) + w.conf);
    }
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? cleanAisleNo(best[0]) : null;
}

/** Best confident digits-only read of the big glyph across photos, or null. A weak read is treated as "didn't see it". */
export function glyphNumber(results) {
  let best = null;
  for (const r of results || []) {
    const n = r && r.number;
    if (!n || !(n.conf >= 50)) continue;
    const no = cleanAisleNo(String(n.text ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
    if (!no || +no < 1 || (best && n.conf <= best.conf)) continue;
    best = { no, conf: n.conf };
  }
  return best ? best.no : null;
}

/** Text-only rules: "Aisle 7"; a line that is just a number; a line like "A 8 B" (number between side letters). */
export function findAisleNo(text) {
  const m = text.match(/\baisle\s*#?\s*(\d{1,3}[a-z]?)\b/i);
  if (m) return cleanAisleNo(m[1]);
  const found = [];
  for (const line of text.split("\n")) {
    const t = line.trim().split(/\s+/);
    const nums = t.filter((x) => /^\d{1,2}$/.test(x) && +x >= 1 && +x <= 60);
    const rest = t.filter((x) => !/^\d{1,2}$/.test(x));
    if (nums.length === 1 && rest.length <= 2 && rest.every((x) => /^[A-Za-z]$/.test(x))) found.push(nums[0]);
  }
  return found.length === 1 ? cleanAisleNo(found[0]) : null;
}

/** Group confident words into phrases: same line, split where a wide gap separates columns. */
export function phrasesFromWords(words, minConf = 60) {
  const ok = words.filter((w) => w.conf >= minConf && w.text.trim());
  const lines = new Map();
  if (ok.every((w) => w.line != null)) {
    for (const w of ok) lines.set(w.line, [...(lines.get(w.line) || []), w]);
  } else { // no line ids: cluster by vertical centre
    let n = 0, last = null;
    for (const w of [...ok].sort((a, b) => a.top - b.top)) {
      const cy = w.top + w.height / 2;
      if (!last || Math.abs(cy - last.cy) > 0.6 * Math.max(w.height, last.h)) { n++; }
      last = { cy, h: w.height };
      lines.set(n, [...(lines.get(n) || []), w]);
    }
  }
  const phrases = [];
  for (const ws of lines.values()) {
    ws.sort((a, b) => a.left - b.left);
    let cur = [ws[0]];
    for (const w of ws.slice(1)) {
      const prev = cur[cur.length - 1];
      if (w.left - (prev.left + prev.width) > Math.max(prev.height, w.height)) { phrases.push(cur); cur = []; }
      cur.push(w);
    }
    phrases.push(cur);
  }
  return phrases.map((p) => p.map((w) => w.text).join(" "));
}

/** One OCR fragment → a category string, or null if it looks like a price, noise, or filler. */
function toCategory(piece) {
  if (/[\d$%@#]/.test(piece)) return null; // prices, sizes, codes
  const s = piece.replace(/[^a-zA-Z' -]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const words = s.split(" ").filter(Boolean);
  if (!words.length || words.length > 4 || s.length < 3 || s.length > 30) return null;
  if (words.every((w) => STOP.has(w))) return null;
  if (words.some((w) => w.length < 2 || !/[aeiouy]/.test(w) || /(.)\1{3,}/.test(w))) return null; // OCR garbage
  return words.join(" ");
}

const piecesFromText = (t) => t.split(/[\n,•·|\/&;\t]+|\s{2,}|\s[-–—]\s/);

/** "soap" is redundant next to "dish soap" (one pass saw the whole phrase, another only part of it). */
const dropParts = (list) => list.filter((c) => !list.some((d) => d !== c && d.length > c.length && ` ${d} `.includes(` ${c} `)));

/** Combine any number of OCR passes (different photos or image variants) into one answer. */
export function extractFromOcrResults(results) {
  const rs = (results || []).map((r) => ({ text: String(r.text ?? ""), words: r.words || [], number: r.number }));
  const found = rs.flatMap((r) => (r.words.length ? phrasesFromWords(r.words) : piecesFromText(r.text)).map(toCategory).filter(Boolean));
  const unique = dropParts([...new Set(found)]);
  const known = unique.filter((c) => c.split(" ").some(isKnown) || isKnown(c));
  // Keep recognised shopping words first; other lines only if every word is a clean 3+ letters.
  const other = unique.filter((c) => !known.includes(c) && c.split(" ").every((w) => w.length >= 3));
  const text = rs.map((r) => r.text).join("\n");
  // Order: a printed "Aisle 7" > the big glyph read on its own > the biggest digit word OCR happened to see > lone-number rules.
  const aisleNo = (text && /\baisle\b/i.test(text) ? findAisleNo(text) : null)
    || glyphNumber(rs)
    || bigNumber(rs.map((r) => r.words).filter((w) => w.length))
    || findAisleNo(text);
  return { categories: cleanCategories([...known, ...other]), aisleNo };
}

/** Plain-text convenience wrapper. */
export const extractFromOcrText = (text) => extractFromOcrResults([{ text }]);
