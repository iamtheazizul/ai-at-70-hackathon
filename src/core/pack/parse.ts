// Turn a pack's on-disk representation into the domain types.
//
// Pure: takes strings and plain row objects, returns types or a list of
// complaints. The file system and SQLite live in src/pack/, so everything here
// runs in CI without a pack on disk.
//
// This is the layer that exists because the pack is snake_case on disk (plan
// §3's manifest.json and store.sqlite) while the core is camelCase. Doing the
// mapping in one audited place beats scattering `row.a_node` through the app.

import type { Aisle, Edge, Product, ProductLocation, Section, StoreNode } from '../types';
import type { PackManifest, PackedDistance } from './manifest';
import type { PackData } from './validators';

/** Rows as they come out of store.sqlite, one array per table. */
export interface PackRows {
  store: Record<string, unknown>[];
  node: Record<string, unknown>[];
  edge: Record<string, unknown>[];
  aisle: Record<string, unknown>[];
  aisle_sign_variant: Record<string, unknown>[];
  section: Record<string, unknown>[];
  product: Record<string, unknown>[];
  product_barcode: Record<string, unknown>[];
  product_location: Record<string, unknown>[];
  node_distance: Record<string, unknown>[];
  scheduled_product: Record<string, unknown>[];
}

export interface Parsed<T> {
  value?: T;
  errors: string[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** SQLite has no boolean: the pack stores 1 and 0. */
const bool = (v: unknown): boolean => v === 1 || v === true;
/** SQL NULL becomes undefined, so optional domain fields stay absent. */
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function parseManifest(text: string): Parsed<PackManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { errors: [`manifest.json is not valid JSON: ${(e as Error).message}`] };
  }
  if (typeof raw !== 'object' || raw === null) return { errors: ['manifest.json is not an object'] };
  const m = raw as Record<string, any>;
  const errors: string[] = [];

  const need = <T>(path: string, v: T | undefined): T => {
    if (v === undefined) errors.push(`manifest.json is missing or malformed: ${path}`);
    return v as T;
  };

  const files: PackManifest['files'] = [];
  if (!Array.isArray(m.files)) {
    errors.push('manifest.json is missing or malformed: files');
  } else {
    m.files.forEach((f: Record<string, unknown>, i: number) => {
      const path = str(f?.path);
      const sha256 = str(f?.sha256);
      const bytes = num(f?.bytes);
      if (path === undefined || sha256 === undefined || bytes === undefined) {
        errors.push(`manifest.json files[${i}] needs path, sha256 and bytes`);
        return;
      }
      files.push({ path, sha256, bytes });
    });
  }

  const value: PackManifest = {
    packId: need('pack_id', str(m.pack_id)),
    packVersion: need('pack_version', num(m.pack_version)),
    layoutVersion: need('layout_version', str(m.layout_version)),
    builtAt: need('built_at', str(m.built_at)),
    surveyedBetween: [
      str(m.surveyed_between?.[0]) ?? '',
      str(m.surveyed_between?.[1]) ?? '',
    ],
    store: {
      id: need('store.id', num(m.store?.id)),
      name: need('store.name', str(m.store?.name)),
    },
    counts: {
      nodes: num(m.counts?.nodes) ?? 0,
      edges: num(m.counts?.edges) ?? 0,
      products: num(m.counts?.products) ?? 0,
      locations: num(m.counts?.locations) ?? 0,
      photos: num(m.counts?.photos) ?? 0,
    },
    requires: {
      minAppSchema: num(m.requires?.min_app_schema) ?? 0,
      recognition: Array.isArray(m.requires?.recognition) ? m.requires.recognition.filter((x: unknown) => typeof x === 'string') : [],
    },
    files,
  };

  if (value.surveyedBetween[0] === '' || value.surveyedBetween[1] === '') {
    errors.push('manifest.json is missing or malformed: surveyed_between');
  }

  return errors.length > 0 ? { errors } : { value, errors };
}

/** The directory name a pack installs under, from plan §3. */
export function packDirectoryName(manifest: PackManifest): string {
  return `${manifest.packId}-v${manifest.packVersion}`;
}

export function assemblePack(rows: PackRows): Parsed<PackData> {
  const errors: string[] = [];

  const nodes: StoreNode[] = rows.node.map((r) => ({
    id: r.id as number,
    kind: r.kind as StoreNode['kind'],
    label: r.label as string,
    aisleId: opt(r.aisle_id as number | null),
    xMetres: opt(r.x_metres as number | null),
    yMetres: opt(r.y_metres as number | null),
    photoPath: opt(r.photo_path as string | null),
  }));

  const edges: Edge[] = rows.edge.map((r) => ({
    a: r.a_node as number,
    b: r.b_node as number,
    metres: r.metres as number,
    measured: bool(r.measured),
  }));

  const variantsByAisle = new Map<number, Aisle['signVariants']>();
  for (const r of rows.aisle_sign_variant) {
    const id = r.aisle_id as number;
    if (!variantsByAisle.has(id)) variantsByAisle.set(id, []);
    variantsByAisle.get(id)!.push({ variant: r.variant as string, kind: r.kind as 'number' | 'category' });
  }

  const endsByAisle = new Map<number, number[]>();
  for (const d of nodes) {
    if (d.aisleId === undefined) continue;
    if (!endsByAisle.has(d.aisleId)) endsByAisle.set(d.aisleId, []);
    endsByAisle.get(d.aisleId)!.push(d.id);
  }

  const aisles: Aisle[] = rows.aisle.map((r) => ({
    id: r.id as number,
    label: r.label as string,
    referenceEndNode: r.reference_end_node as number,
    ends: endsByAisle.get(r.id as number) ?? [],
    signVariants: variantsByAisle.get(r.id as number) ?? [],
    isCold: bool(r.is_cold),
    coldRelaxed: bool(r.cold_relaxed),
  }));

  const sections: Section[] = rows.section.map((r) => ({
    id: r.id as number,
    aisleId: r.aisle_id as number,
    side: r.side as 'left' | 'right',
    bay: r.bay as number,
    accessNode: r.access_node as number,
  }));

  const products: Product[] = rows.product.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    brand: opt(r.brand as string | null),
    variant: opt(r.variant as string | null),
    sizeText: opt(r.size_text as string | null),
    category: r.category as string,
    photoPath: opt(r.photo_path as string | null),
  }));

  const locations: ProductLocation[] = rows.product_location.map((r) => ({
    productId: r.product_id as number,
    sectionId: r.section_id as number,
    shelfLevel: opt(r.shelf_level as ProductLocation['shelfLevel'] | null),
    source: r.source as ProductLocation['source'],
    verifiedOn: r.verified_on as string,
    reviewStatus: r.review_status as ProductLocation['reviewStatus'],
  }));

  const distances: PackedDistance[] = [];
  rows.node_distance.forEach((r, i) => {
    let path: unknown;
    try {
      path = JSON.parse(String(r.path_json));
    } catch {
      errors.push(`node_distance row ${i} has unreadable path_json`);
      return;
    }
    if (!Array.isArray(path) || !path.every((x) => typeof x === 'number')) {
      errors.push(`node_distance row ${i} path_json is not a list of node ids`);
      return;
    }
    distances.push({
      fromNode: r.from_node as number,
      toNode: r.to_node as number,
      metres: r.metres as number,
      path: path as number[],
    });
  });

  const entrance = nodes.find((d) => d.kind === 'entrance');
  const checkout = nodes.find((d) => d.kind === 'checkout');
  if (!entrance) errors.push('the pack has no node of kind "entrance"');
  if (!checkout) errors.push('the pack has no node of kind "checkout"');
  if (errors.length > 0) return { errors };

  return {
    value: {
      nodes, edges, aisles, sections, products, locations, distances,
      entranceNode: entrance!.id,
      checkoutNode: checkout!.id,
    },
    errors,
  };
}

/** Products the pack says are on the scheduled lists (plan D5). */
export function scheduledProductsFrom(rows: PackRows): number[] {
  return rows.scheduled_product.map((r) => r.product_id as number);
}
