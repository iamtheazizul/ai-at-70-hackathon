import type { Catalog, Product } from "./types";
import { normalizeTranscript } from "./commands";

export function aisleFor(productId: number, storeId: number, catalog: Catalog): string | null {
  const location = catalog.locations.find(
    (row) => row.storeId === storeId && row.productId === productId,
  );
  return location?.aisle ?? null;
}

/** Exact product name or exact synonym only. Never assigns an aisle by guessing. */
export function resolveExact(query: string, catalog: Catalog): Product | null {
  const normalized = normalizeTranscript(query);
  if (!normalized) return null;

  const ids = new Set<number>();
  for (const product of catalog.products) {
    if (normalizeTranscript(product.name) === normalized) ids.add(product.id);
  }
  for (const synonym of catalog.synonyms) {
    if (normalizeTranscript(synonym.phrase) === normalized) ids.add(synonym.productId);
  }
  if (ids.size !== 1) return null;

  const id = [...ids][0];
  return catalog.products.find((product) => product.id === id) ?? null;
}

/** Name and synonym search for the list picker. Partial matches are candidates, not auto-aisles. */
export function searchCatalog(query: string, catalog: Catalog): Product[] {
  const normalized = normalizeTranscript(query);
  if (normalized.length < 2) return [];

  const ids = new Set<number>();
  for (const product of catalog.products) {
    const name = normalizeTranscript(product.name);
    if (name === normalized || name.includes(normalized)) ids.add(product.id);
  }
  for (const synonym of catalog.synonyms) {
    const phrase = normalizeTranscript(synonym.phrase);
    if (phrase === normalized || phrase.includes(normalized)) ids.add(synonym.productId);
  }

  return catalog.products.filter((product) => ids.has(product.id));
}

export function substituteFor(productId: number, storeId: number, catalog: Catalog): Product | null {
  const rule = catalog.rules.find(
    (row) => row.storeId === storeId && row.productId === productId,
  );
  if (!rule) return null;
  return catalog.products.find((product) => product.id === rule.substituteProductId) ?? null;
}
