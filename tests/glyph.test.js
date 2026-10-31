// Finding the big aisle number by shape and size, without OCR.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findBigGlyphs } from "../src/services/bigGlyph.js";

function readPgm(name) {
  const b = gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  let i = 0; const tok = [];
  while (tok.length < 4) { let s = ""; while (b[i] > 32) s += String.fromCharCode(b[i++]); i++; tok.push(s); }
  return { width: +tok[1], height: +tok[2], gray: new Uint8Array(b.subarray(i)) };
}

// --- tiny drawing helpers for synthetic pictures ---
const picture = (width, height, bg) => ({ width, height, gray: new Uint8Array(width * height).fill(bg) });
const rect = (im, x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) im.gray[j * im.width + i] = v; };
const ring = (im, x, y, w, h, t, v, hole) => { rect(im, x, y, w, h, v); rect(im, x + t, y + t, w - 2 * t, h - 2 * t, hole); }; // a "0"-ish glyph
const smallText = (im, v) => { for (let row = 0; row < 3; row++) for (let k = 0; k < 14; k++) rect(im, 20 + k * 16, 150 + row * 12, 7, 9, v); };

test("reference sign: finds the big 8, and only the 8", () => {
  const found = findBigGlyphs(readPgm("sign_gray.pgm.gz"));
  assert.equal(found.length, 1, JSON.stringify(found));
  const g = found[0];
  assert.equal(g.polarity, "bright"); // white 8 on a green header
  assert.ok(Math.abs(g.x - 176) <= 6 && Math.abs(g.y - 161) <= 6, `position ${g.x},${g.y}`);
  assert.ok(Math.abs(g.w - 41) <= 6 && Math.abs(g.h - 59) <= 6, `size ${g.w}x${g.h}`);
});

test("synthetic: light glyph on dark and dark glyph on light are both found", () => {
  const a = picture(300, 200, 30); ring(a, 130, 40, 40, 60, 8, 240, 30); smallText(a, 220);
  const b = picture(300, 200, 230); ring(b, 130, 40, 40, 60, 8, 20, 230); smallText(b, 40);
  const fa = findBigGlyphs(a), fb = findBigGlyphs(b);
  assert.equal(fa.length, 1); assert.equal(fa[0].polarity, "bright");
  assert.equal(fb.length, 1); assert.equal(fb[0].polarity, "dark");
  for (const g of [fa[0], fb[0]]) assert.ok(Math.abs(g.x - 130) <= 3 && Math.abs(g.y - 40) <= 3 && Math.abs(g.h - 60) <= 4);
});

test("synthetic: two side-by-side digits are joined into one number", () => {
  const im = picture(300, 200, 30);
  ring(im, 100, 40, 36, 60, 8, 240, 30); ring(im, 150, 40, 36, 60, 8, 240, 30); smallText(im, 220);
  const found = findBigGlyphs(im);
  assert.equal(found.length, 1);
  assert.ok(found[0].x <= 102 && found[0].x + found[0].w >= 184, JSON.stringify(found[0]));
});

test("synthetic: ordinary text, long lines, wide bars and picture-edge frames are not numbers", () => {
  const im = picture(300, 200, 30);
  smallText(im, 220);
  rect(im, 20, 20, 260, 3, 240);   // a long thin line (dimension mark)
  rect(im, 285, 10, 3, 120, 240);  // a tall thin line
  ring(im, 40, 40, 220, 70, 6, 240, 30); // a wide bar-like frame
  ring(im, 0, 0, 300, 200, 5, 240, 30);  // frame touching the edge
  assert.deepEqual(findBigGlyphs(im), []);
});

test("empty or broken input never throws", () => {
  assert.deepEqual(findBigGlyphs({ width: 0, height: 0, gray: new Uint8Array(0) }), []);
  assert.deepEqual(findBigGlyphs({ width: 10, height: 10, gray: new Uint8Array(5) }), []);
  assert.deepEqual(findBigGlyphs(picture(200, 200, 128)), []); // flat gray: nothing there
});
