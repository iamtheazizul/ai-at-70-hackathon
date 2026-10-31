// Translates between the app's store object and the database tables
// (layout_drafts, layout_shapes, layout_shape_categories, layout_neighbours, layout_fixtures).
// Pure functions, no network — the database repository will use these to read and write.
//
// Differences it handles:
//   units        app: cells (1 cell = 2 ft)        db: metres  (x_m, w_m…)
//   shelf height app: feet                         db: metres
//   kind         app: "aisle" | "wall"             db: "aisle" | "section"
//   orient       app: "v" | "h"                    db: "vertical" | "horizontal"
//   flow         app: "cf" | "fc" | "lr" | "rl"    db: "closest_to_furthest" | …
//   ids          app: short client ids             db: uuids; shapes keep the app id in client_id,
//                                                  categories/neighbours refer to shapes by client id
//                                                  here and the repository swaps in uuids on insert.

import { M_PER_CELL } from "../core/constants.js";
import { blankStore, newAisle } from "../core/model.js";

const M_PER_FT = 0.3048;
const round = (n, d = 4) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const toM = (cells) => (cells == null ? null : round(cells * M_PER_CELL));
const toCells = (m) => (m == null ? null : round(Number(m) / M_PER_CELL, 3));

const FLOW_DB = { cf: "closest_to_furthest", fc: "furthest_to_closest", lr: "left_to_right", rl: "right_to_left" };
const FLOW_APP = Object.fromEntries(Object.entries(FLOW_DB).map(([k, v]) => [v, k]));
const ORIENT_DB = { v: "vertical", h: "horizontal" };
const ORIENT_APP = { vertical: "v", horizontal: "h" };

export const slugify = (s) =>
  (s || "store").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "store";

/**
 * App store → rows for the database.
 * @param ctx { storeId, mapVersionId, floorId, userId }
 */
export function storeToRows(S, ctx) {
  const { storeId, mapVersionId, floorId, userId = null } = ctx;

  const store = { id: storeId, slug: slugify(S.name || S.address), name: S.name || "Untitled store", address: S.address || null };

  const layout_draft = {
    map_version_id: mapVersionId, store_id: storeId, floor_id: floorId,
    stage: S.stage || "address", reached: S.reached || 0, wizard_index: S.cur || 0,
    floor_w_m: S.W ? toM(S.W) : null, floor_h_m: S.H ? toM(S.H) : null,
    placed: !!S.placed, layout_stale: !!S.dirty, updated_by: userId,
  };

  const layout_shapes = S.aisles.map((a, position) => ({
    map_version_id: mapVersionId, client_id: a.id, position,
    code: a.no || "", kind: a.kind === "aisle" ? "aisle" : "section",
    name: a.name || "", dept: a.dept || "Other", color: a.color,
    orient: ORIENT_DB[a.orient] || null, flow: FLOW_DB[a.flow] || null,
    x_m: toM(a.x), y_m: toM(a.y), w_m: toM(a.w), h_m: toM(a.h),
    shelf_height_m: a.ht ? round(a.ht * M_PER_FT) : null,
    custom_name: !!a.customName, custom_dept: !!a.customDept, custom_color: !!a.customColor,
  }));

  // aisles: left shelf then right shelf; sections: their items. position is unique per shape.
  const layout_shape_categories = S.aisles.flatMap((a) => {
    const rows = a.kind === "aisle"
      ? [...(a.left || []).map((label) => ({ label, side: "left" })), ...(a.right || []).map((label) => ({ label, side: "right" }))]
      : (a.items || []).map((label) => ({ label, side: null }));
    return rows.map((r, position) => ({ shape_client_id: a.id, position, label: r.label, side: r.side, product_id: null }));
  });

  const ids = new Set(S.aisles.map((a) => a.id));
  const layout_neighbours = S.aisles.flatMap((a) =>
    Object.entries(a.nb || {}).map(([point, v]) => ({
      map_version_id: mapVersionId, shape_client_id: a.id, point,
      target_client_id: ids.has(v) ? v : null, target_special: ids.has(v) ? null : v,
    })));

  const layout_fixtures = (S.fixtures || []).map((f) => ({
    map_version_id: mapVersionId, kind: f.kind === "door" ? "entrance" : "checkout", name: f.name,
    x_m: toM(f.x), y_m: toM(f.y), w_m: toM(f.w), h_m: toM(f.h),
  }));

  return { store, layout_draft, layout_shapes, layout_shape_categories, layout_neighbours, layout_fixtures };
}

/**
 * Database rows → app store. Categories and neighbours may refer to shapes either by
 * shape_client_id (as produced above) or by shape_id / target_shape_id uuids (as read back).
 */
export function rowsToStore(rows) {
  const { store, layout_draft: d = {}, layout_shapes = [], layout_shape_categories = [], layout_neighbours = [], layout_fixtures = [] } = rows;
  // uuid → client id (only for rows that came from the database and have a uuid)
  const clientOf = new Map(layout_shapes.filter((s) => s.id).map((s) => [s.id, s.client_id]));
  const shapeKey = (r) => r.shape_client_id || (r.shape_id ? clientOf.get(r.shape_id) : undefined);
  const targetKey = (r) => r.target_client_id || (r.target_shape_id ? clientOf.get(r.target_shape_id) : undefined);

  const S = Object.assign(blankStore(), {
    id: store?.id || blankStore().id, name: store?.name || "", address: store?.address || "",
    stage: d.stage || "address", reached: d.reached || 0, cur: d.wizard_index || 0,
    placed: !!d.placed, dirty: !!d.layout_stale,
  });
  if (d.floor_w_m != null) S.W = Math.round(toCells(d.floor_w_m));
  if (d.floor_h_m != null) S.H = Math.round(toCells(d.floor_h_m));

  S.aisles = [...layout_shapes].sort((a, b) => a.position - b.position).map((s) => {
    const a = Object.assign(newAisle(), {
      id: s.client_id, no: s.code || "", kind: s.kind === "aisle" ? "aisle" : "wall",
      name: s.name, dept: s.dept, color: s.color,
      orient: ORIENT_APP[s.orient] || null, flow: FLOW_APP[s.flow] || null,
      customName: !!s.custom_name, customDept: !!s.custom_dept, customColor: !!s.custom_color,
    });
    if (s.x_m != null) Object.assign(a, { x: toCells(s.x_m), y: toCells(s.y_m), w: toCells(s.w_m), h: toCells(s.h_m) });
    if (s.shelf_height_m != null) a.ht = Math.round(Number(s.shelf_height_m) / M_PER_FT);
    return a;
  });
  const byClient = new Map(S.aisles.map((a) => [a.id, a]));

  [...layout_shape_categories].sort((a, b) => a.position - b.position).forEach((c) => {
    const a = byClient.get(shapeKey(c));
    if (!a) return;
    if (c.side === "left" || c.side === "right") a[c.side].push(c.label);
    else a.items.push(c.label);
  });
  S.aisles.forEach((a) => { if (a.kind === "aisle") a.items = [...a.left, ...a.right]; });

  layout_neighbours.forEach((n) => {
    const a = byClient.get(shapeKey(n));
    if (a) a.nb[n.point] = targetKey(n) || n.target_special;
  });

  S.fixtures = layout_fixtures.map((f) => ({
    id: f.kind === "entrance" ? "ent" : "chk", name: f.name, kind: f.kind === "entrance" ? "door" : "fixture",
    x: toCells(f.x_m), y: toCells(f.y_m), w: toCells(f.w_m), h: toCells(f.h_m),
  }));
  S.count = S.aisles.length;
  return S;
}
