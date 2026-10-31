// OCR text → categories and aisle number.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromOcrText, findAisleNo } from "../src/services/ocrParse.js";

test("reads a typical hanging sign", () => {
  const r = extractFromOcrText("AISLE 7\nCEREAL & BREAKFAST\nPeanut Butter, Jam\n$3.99 each\nSAVE 20%\nxqzt\n");
  assert.equal(r.aisleNo, "7");
  assert.deepEqual(r.categories, ["cereal", "breakfast", "peanut butter", "jam"]);
});

test("drops prices, sizes, filler words and OCR garbage", () => {
  const r = extractFromOcrText("Pasta\n16 oz\n$1.29\nSALE\nNEW\nllllll\nrtsk\nCanned Soup");
  assert.deepEqual(r.categories, ["pasta", "canned soup"]);
});

test("aisle number: explicit wins, a single big number works, ambiguous gives null", () => {
  assert.equal(findAisleNo("Aisle #12\nSnacks"), "12");
  assert.equal(findAisleNo("aisle 4b"), "4B");
  assert.equal(findAisleNo("12\nCondiments\nSauces"), "12");
  assert.equal(findAisleNo("3\n5\nSnacks"), null);
  assert.equal(findAisleNo("Aisle\nSnacks"), null);
  assert.equal(findAisleNo("99\nSnacks"), null);
});

test("recognised shopping words come before unknown ones, and plurals match", () => {
  const r = extractFromOcrText("Gourmet Goods\nChips\nCookies");
  assert.deepEqual(r.categories.slice(0, 2), ["chips", "cookies"]);
  assert.ok(r.categories.includes("gourmet goods"));
});

test("empty or junk text gives empty results, never throws", () => {
  assert.deepEqual(extractFromOcrText(""), { categories: [], aisleNo: null });
  assert.deepEqual(extractFromOcrText(null), { categories: [], aisleNo: null });
  assert.deepEqual(extractFromOcrText("!!! ### $$$ 123 456"), { categories: [], aisleNo: null });
});

// --- real Tesseract output for the reference sign (green header, big "8" between A and B,
//     two columns of categories). Each pass alone misses something; together they get it all. ---
import { readFileSync } from "node:fs";
import { wordsFromTsv, extractFromOcrResults, phrasesFromWords } from "../src/services/ocrParse.js";

const pass = (n) => ({ words: wordsFromTsv(readFileSync(new URL(`./fixtures/${n}.tsv`, import.meta.url), "utf8")) });

test("reference sign: big number found by size, all six categories, no digits or dimension marks", () => {
  const r = extractFromOcrResults(["gray_x3", "invmin_x3", "invred_x3"].map(pass));
  assert.equal(r.aisleNo, "8");
  for (const c of ["insecticides", "cleaners", "dish soap", "toothpaste", "deodorant", "shampoo"]) assert.ok(r.categories.includes(c), c);
  assert.ok(r.categories.every((c) => !/\d/.test(c)));
  assert.ok(!r.categories.includes("soap"), "part of 'dish soap' is dropped");
});

test("reference sign: the number is found from a single pass, and 18/36 dimension marks are ignored", () => {
  assert.equal(extractFromOcrResults([pass("invred_x3")]).aisleNo, "8");
  assert.equal(extractFromOcrResults([pass("invmin_x3")]).aisleNo, null); // this pass never saw the 8, and must not guess from "18"
});

test("two-column rows are split by the gap between columns", () => {
  const w = (text, left, width) => ({ text, conf: 95, left, width, top: 100, height: 20, line: "1-1-1" });
  const row = [w("CLEANERS", 70, 80), w("DEODORANT", 230, 95), w("DISH", 70, 35), w("SOAP", 110, 40)].map((x, i) => (i > 1 ? { ...x, top: 140, line: "1-1-2" } : x));
  assert.deepEqual(phrasesFromWords(row), ["CLEANERS", "DEODORANT", "DISH SOAP"]);
});

test("side letters around the number in plain text", () => {
  assert.equal(findAisleNo("A 8 B\nINSECTICIDES  TOOTHPASTE"), "8");
  assert.equal(findAisleNo("A 8 5 Wl"), null); // two numbers: ambiguous without sizes
  assert.deepEqual(extractFromOcrText("INSECTICIDES  TOOTHPASTE\nDISH SOAP  SHAMPOO").categories.sort(), ["dish soap", "insecticides", "shampoo", "toothpaste"]);
});

// --- the big number read on its own (bigGlyph.js finds the glyph, ocr.js reads the crop, digits only) ---
import { glyphNumber } from "../src/services/ocrParse.js";

test("big-glyph read fills the aisle number even when no OCR word was the number", () => {
  // every normal pass missed the 8 (it came back as noise), but the crop read it confidently
  const noisy = { text: "Double Sided\n18\nINSECTICIDES  TOOTHPASTE", words: [] };
  const r = extractFromOcrResults([noisy, { text: "", words: [], number: { text: "8", conf: 96 } }]);
  assert.equal(r.aisleNo, "8");
  assert.ok(r.categories.includes("insecticides") && r.categories.includes("toothpaste"));
});

test("big-glyph read beats the lone '18' dimension mark that the text rules would pick", () => {
  assert.equal(extractFromOcrResults([{ text: "18\nCLEANERS" }]).aisleNo, "18"); // old behaviour without a glyph read
  assert.equal(extractFromOcrResults([{ text: "18\nCLEANERS" }, { number: { text: "8", conf: 90 } }]).aisleNo, "8");
});

test("big-glyph read: weak or odd reads are ignored; a printed 'Aisle N' still wins; best confidence wins", () => {
  assert.equal(glyphNumber([{ number: { text: "8", conf: 20 } }]), null);
  assert.equal(glyphNumber([{ number: { text: "", conf: 99 } }]), null);
  assert.equal(glyphNumber([{ number: { text: "0", conf: 99 } }]), null);
  assert.equal(glyphNumber([{ number: { text: "1234", conf: 99 } }]), null);
  assert.equal(glyphNumber([{ number: { text: "08", conf: 80 } }]), "8");
  assert.equal(glyphNumber([{ number: { text: "3", conf: 60 } }, { number: { text: "8", conf: 95 } }]), "8");
  assert.equal(glyphNumber(null), null);
  assert.equal(extractFromOcrResults([{ text: "AISLE 7\nSnacks" }, { number: { text: "8", conf: 99 } }]).aisleNo, "7");
});
