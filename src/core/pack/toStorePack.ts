// Turn an installed pack into the StorePack the app already consumes.
//
// src/app/guidance.ts takes StorePack everywhere, so this is the whole seam
// between "a pack exists on disk" and "the trip runs on it". Pure: rows in,
// StorePack out.

import type { ProductId, StorePack } from '../types';
import type { PackManifest, PackedDistance } from './manifest';
import { assemblePack, type PackRows, type Parsed } from './parse';

export interface LoadedPack {
  pack: StorePack;
  /** node_distance as packed, so RouteCore never recomputes it. */
  distances: PackedDistance[];
  manifest: PackManifest;
}

export function toStorePack(rows: PackRows, manifest: PackManifest): Parsed<LoadedPack> {
  const assembled = assemblePack(rows);
  if (!assembled.value) return { errors: assembled.errors };
  const d = assembled.value;

  const barcodes: Record<string, ProductId> = {};
  for (const row of rows.product_barcode) {
    barcodes[String(row.barcode)] = row.product_id as ProductId;
  }

  return {
    value: {
      pack: {
        packId: manifest.packId,
        packVersion: manifest.packVersion,
        layoutVersion: manifest.layoutVersion,
        storeName: manifest.store.name,
        nodes: d.nodes,
        edges: d.edges,
        aisles: d.aisles,
        sections: d.sections,
        products: d.products,
        barcodes,
        locations: d.locations,
        entranceNode: d.entranceNode,
        checkoutNode: d.checkoutNode,
      },
      distances: d.distances,
      manifest,
    },
    errors: [],
  };
}
