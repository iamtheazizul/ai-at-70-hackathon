// Shape geometry on the map (units: cells, 1 cell = 2 ft; y grows toward the entrance).
//
// A coded aisle is drawn as a walkway with a shelf strip along each long side:
//
//   vertical aisle            horizontal aisle
//   ┌─┬────┬─┐               ┌──────────────┐  north strip
//   │W│walk│E│               │   walkway    │
//   │ │    │ │               └──────────────┘  south strip
//   └─┴────┴─┘
//
// Sections (Produce, Bakery…) are a single solid block.

import { SHELF_DEPTH, SIDE_TO_WALL, FT_PER_CELL } from "./constants.js";
import { isAisle, orientOf, effectiveFlow } from "./model.js";

/** Solid shelf rectangles of a shape. Shoppers can't walk through these. */
export function shelfStrips(a) {
  if (!isAisle(a)) return [{ x: a.x, y: a.y, w: a.w, h: a.h, wall: null }];
  const d = SHELF_DEPTH;
  return orientOf(a) === "v"
    ? [{ x: a.x, y: a.y, w: d, h: a.h, wall: "west" }, { x: a.x + a.w - d, y: a.y, w: d, h: a.h, wall: "east" }]
    : [{ x: a.x, y: a.y, w: a.w, h: d, wall: "north" }, { x: a.x, y: a.y + a.h - d, w: a.w, h: d, wall: "south" }];
}

/** The physical shelf ("north" | "south" | "east" | "west") on your left/right while walking the aisle. */
export const wallFor = (a, side) => SIDE_TO_WALL[effectiveFlow(a)][side];

/**
 * Where to stand for the index-th category (of count) on one side of an aisle.
 * Categories are spread evenly along the aisle, starting at the end the aisle flows from.
 * Returns map coordinates plus how far in from the start that is, in feet.
 */
export function spotPoint(a, side, index, count) {
  const flow = effectiveFlow(a), vert = orientOf(a) === "v";
  const len = vert ? a.h : a.w;
  const t = (index + 0.5) / Math.max(1, count); // 0 = start of the aisle, 1 = end
  const off = SHELF_DEPTH + 0.75; // stand just in front of the shelf
  const wall = wallFor(a, side);
  let x, y;
  if (vert) {
    y = flow === "cf" ? a.y + a.h - t * len : a.y + t * len; // cf starts at the entrance (bottom) end
    x = wall === "west" ? a.x + off : a.x + a.w - off;
  } else {
    x = flow === "lr" ? a.x + t * len : a.x + a.w - t * len;
    y = wall === "north" ? a.y + off : a.y + a.h - off;
  }
  return { x, y, alongFt: Math.round(t * len * FT_PER_CELL) };
}
