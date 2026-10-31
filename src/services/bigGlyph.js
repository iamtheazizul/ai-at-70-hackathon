// Finds the oversized glyph (the aisle number) on a sign by shape and size, without OCR.
// Pure functions: runs in the browser, in Node, and in tests.
//
// Why: OCR often fails to even *notice* a big number on a coloured header (it comes back as "s",
// "Wl", or nothing, at a confidence that moves with how the photo was upscaled). Finding the glyph
// geometrically and then reading only a small crop of it is far steadier.
//
// Input is a grayscale picture: { width, height, gray: Uint8Array | Uint8ClampedArray (0-255) }.
// Output is a list of candidate boxes, biggest first:
//   { x, y, w, h, polarity: "bright" | "dark" }   (polarity = is the glyph lighter or darker than its surroundings)

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Mean of a (2r+1)² window around every pixel, via an integral image. */
function localMean(gray, W, H, r) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += gray[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      out[y * W + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** Connected blobs (8-neighbour) of a boolean mask, as bounding boxes with pixel counts. */
function blobs(mask, W, H) {
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H), out = [];
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0, area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      const p = stack[--sp], x = p % W, y = (p / W) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, q = ny * W + nx;
          if (nx < 0 || nx >= W || seen[q] || !mask[q]) continue;
          seen[q] = 1; stack[sp++] = q;
        }
      }
    }
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return out;
}

/**
 * Candidate boxes for the big number, biggest first (at most `max`).
 * A candidate is a blob (or a row of 2-3 similar blobs, like "12") that is clearly taller than the
 * ordinary text on the sign, digit-shaped, and not a frame, a line or a whole header bar.
 */
export function findBigGlyphs({ width: W, height: H, gray }, { max = 3, minRatio = 1.8 } = {}) {
  if (!W || !H || !gray || gray.length < W * H) return [];
  const r = Math.max(8, Math.round(Math.min(W, H) / 10)); // window larger than a stroke, smaller than the sign
  const mean = localMean(gray, W, H, r);
  const DELTA = 22;

  const found = [];
  for (const polarity of ["bright", "dark"]) {
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = polarity === "bright" ? gray[i] > mean[i] + DELTA : gray[i] < mean[i] - DELTA;
    for (const b of blobs(mask, W, H)) if (b.area >= 6) found.push({ ...b, polarity });
  }

  // "Ordinary text height" on this picture: the median height of mid-sized blobs.
  const ref = median(found.filter((b) => b.h >= 4 && b.h <= 0.25 * H).map((b) => b.h)) || 0.04 * H;

  const single = found.filter((b) => {
    const aspect = b.h / b.w, fill = b.area / (b.w * b.h);
    return b.h >= minRatio * ref && b.h <= 0.6 * H && b.w <= 0.5 * W // taller than the text, not a frame
      && aspect >= 0.8 && aspect <= 6 // digit-shaped, not a line or a wide bar
      && fill >= 0.15 && fill <= 0.85 // a glyph, not a solid block
      && b.x > 0 && b.y > 0 && b.x + b.w < W && b.y + b.h < H; // doesn't touch the picture edge
  });

  // The background right around a glyph also counts as a blob of the opposite kind (a "halo" shell).
  // When one candidate sits almost entirely inside another of the opposite kind, the outer one is the halo: drop it.
  const inside = (a, b) => { // how much of a's box lies inside b's box, 0..1
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / (a.w * a.h) : 0;
  };
  const real = single.filter((b) => !single.some((o) => o !== b && o.polarity !== b.polarity && o.w * o.h < b.w * b.h && inside(o, b) >= 0.85));

  // Join neighbours of similar height and the same baseline into one number ("1" + "2").
  const groups = [];
  for (const b of real.sort((p, q) => p.x - q.x)) {
    const g = groups.find((g) => g.polarity === b.polarity && g.n < 3
      && Math.abs(g.h - b.h) <= 0.3 * g.h
      && Math.min(g.y + g.h, b.y + b.h) - Math.max(g.y, b.y) >= 0.7 * Math.min(g.h, b.h)
      && b.x - (g.x + g.w) <= 0.9 * g.h && b.x >= g.x);
    if (g) {
      const x1 = Math.max(g.x + g.w, b.x + b.w), y0 = Math.min(g.y, b.y), y1 = Math.max(g.y + g.h, b.y + b.h);
      Object.assign(g, { w: x1 - g.x, y: y0, h: y1 - y0, n: g.n + 1 });
    } else groups.push({ x: b.x, y: b.y, w: b.w, h: b.h, polarity: b.polarity, n: 1 });
  }
  return groups.sort((a, b) => b.h - a.h).slice(0, max).map(({ x, y, w, h, polarity }) => ({ x, y, w, h, polarity }));
}
