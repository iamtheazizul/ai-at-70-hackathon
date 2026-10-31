// The fixture in the shape store.sqlite returns: snake_case keys, 1/0 for
// booleans. Shared by the pack tests so one definition backs both the SQLite
// path and the browser path, and they cannot drift apart.
import { buildDistanceMatrix } from '../../src/core/route/distance';
import type { PackRows } from '../../src/core/pack/parse';
import { sampleList, sampleStorePack as fixture } from '../../src/data/sampleStore';

export const SCHEDULED = [...new Set(sampleList.flatMap((e) => e.acceptedProducts))];

/** The fixture as store.sqlite would return it: snake_case, 1/0 for booleans. */
export function fixtureRows(): PackRows {
  const dist = buildDistanceMatrix(fixture.nodes, fixture.edges);
  const node_distance: Record<string, unknown>[] = [];
  for (const a of dist.nodes) {
    for (const b of dist.nodes) {
      if (a === b || !Number.isFinite(dist.metres(a, b))) continue;
      node_distance.push({ from_node: a, to_node: b, metres: dist.metres(a, b), path_json: JSON.stringify(dist.path(a, b)) });
    }
  }
  return {
    store: [{ id: 1, name: fixture.storeName, layout_version: fixture.layoutVersion }],
    node: fixture.nodes.map((n) => ({
      id: n.id, kind: n.kind, label: n.label,
      aisle_id: n.aisleId ?? null, x_metres: n.xMetres ?? null, y_metres: n.yMetres ?? null,
      photo_path: n.photoPath ?? null,
    })),
    edge: fixture.edges.map((e) => ({ a_node: e.a, b_node: e.b, metres: e.metres, measured: e.measured ? 1 : 0 })),
    aisle: fixture.aisles.map((a) => ({
      id: a.id, label: a.label, reference_end_node: a.referenceEndNode,
      is_cold: a.isCold ? 1 : 0, cold_relaxed: a.coldRelaxed ? 1 : 0,
    })),
    aisle_sign_variant: fixture.aisles.flatMap((a) => a.signVariants.map((v) => ({ aisle_id: a.id, variant: v.variant, kind: v.kind }))),
    section: fixture.sections.map((s) => ({ id: s.id, aisle_id: s.aisleId, side: s.side, bay: s.bay, access_node: s.accessNode })),
    product: fixture.products.map((p) => ({
      id: p.id, name: p.name, brand: p.brand ?? null, variant: p.variant ?? null,
      size_text: p.sizeText ?? null, category: p.category, photo_path: p.photoPath ?? null,
    })),
    product_barcode: Object.entries(fixture.barcodes).map(([barcode, product_id]) => ({ barcode, product_id })),
    product_location: fixture.locations.map((l) => ({
      product_id: l.productId, section_id: l.sectionId, shelf_level: l.shelfLevel ?? null,
      source: l.source, verified_on: l.verifiedOn, review_status: l.reviewStatus,
    })),
    node_distance,
    scheduled_product: SCHEDULED.map((product_id) => ({ product_id })),
  };
}

