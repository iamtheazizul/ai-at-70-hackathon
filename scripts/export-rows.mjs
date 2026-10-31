// Export the fixture as the normalised master-data rows that the pack builder
// consumes:
//
//   npm run export-rows -- packs/rows.json
//
// This is the "admin export" end of plan §3's pipeline. Today it reads the
// fixture because the Supabase project is empty; the same JSON shape is what a
// psql dump of the graph tables should produce, so tools/packbuild/build.py
// does not need to know which produced it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadFixture } from './_fixture.mjs';

const SURVEY_DATE = '2026-10-27';
const DIRECTION_NOTE = 'sides named facing from the front-end node';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/export-rows.mjs <out.json>');
  process.exit(1);
}

const { pack, list, dispose } = await loadFixture();
try {
  const rows = {
    pack_id: pack.packId,
    pack_version: pack.packVersion,
    entrance_node: pack.entranceNode,
    checkout_node: pack.checkoutNode,
    store: {
      id: 1,
      name: pack.storeName,
      address: null,
      layout_version: pack.layoutVersion,
      surveyed_on: SURVEY_DATE,
      permitted_activities: {},
    },
    nodes: pack.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      aisle_id: n.aisleId ?? null,
      x_metres: n.xMetres ?? null,
      y_metres: n.yMetres ?? null,
      photo_path: n.photoPath ?? null,
    })),
    // check (a_node < b_node): each undirected edge stored once.
    edges: pack.edges.map((e) => ({
      a_node: Math.min(e.a, e.b),
      b_node: Math.max(e.a, e.b),
      metres: e.metres,
      measured: e.measured,
      verified_on: SURVEY_DATE,
    })),
    aisles: pack.aisles.map((a) => ({
      id: a.id,
      label: a.label,
      reference_end_node: a.referenceEndNode,
      direction_note: DIRECTION_NOTE,
      is_cold: a.isCold,
      cold_relaxed: a.coldRelaxed,
    })),
    aisle_sign_variants: pack.aisles.flatMap((a) =>
      a.signVariants.map((s) => ({ aisle_id: a.id, variant: s.variant, kind: s.kind })),
    ),
    sections: pack.sections.map((s) => ({
      id: s.id,
      aisle_id: s.aisleId,
      side: s.side,
      bay: s.bay,
      access_node: s.accessNode,
    })),
    products: pack.products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand ?? null,
      variant: p.variant ?? null,
      size_text: p.sizeText ?? null,
      category: p.category,
      photo_path: p.photoPath ?? null,
    })),
    product_barcodes: Object.entries(pack.barcodes).map(([barcode, product_id]) => ({
      barcode,
      product_id,
      symbology: 'EAN_13',
    })),
    product_locations: pack.locations.map((l) => ({
      product_id: l.productId,
      section_id: l.sectionId,
      shelf_level: l.shelfLevel ?? null,
      source: l.source,
      verified_on: l.verifiedOn,
      review_status: l.reviewStatus,
    })),
    // Plan D5: the products the scheduled test lists actually ask for. Pack
    // validator 4 checks every one of these has a location in a known section.
    scheduled_products: [...new Set(list.flatMap((e) => e.acceptedProducts))].sort((a, b) => a - b),
  };

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(
    `wrote ${target}: ${rows.nodes.length} nodes, ${rows.edges.length} edges, ${rows.aisles.length} aisles, ` +
    `${rows.sections.length} sections, ${rows.products.length} products, ${rows.scheduled_products.length} scheduled`,
  );
} finally {
  dispose();
}
