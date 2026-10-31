// The six install validators from plan §3, run on-device before a pack becomes
// selectable and again by pack-lint before publishing.
//
// Pure: no file system, no SQLite, no network. The caller reads the staging
// directory and the pack database and hands the results in, which is what makes
// these runnable headlessly in CI (§2's invariant).
//
// Validators 1-5 are blocking and each names what is missing, because the
// failure a shopper must never meet is a pack that installs and then strands
// them in an aisle. Validator 6 is advisory: stale locations are reported so
// the UI can soften its wording, never a reason to refuse the trip.

import type { Aisle, Edge, NodeId, ProductId, ProductLocation, Product, Section, StoreNode } from '../types';
import type { PackManifest, PackedDistance, StagedFile } from './manifest';

export interface Violation {
  /** 1-6, matching the numbering in plan §3. */
  validator: number;
  name: string;
  message: string;
}

export interface ValidationResult {
  /** Validators 1-5. Non-empty means the pack must not be installed. */
  blocking: Violation[];
  /** Validator 6. Stored with the pack so the UI reads it without recomputing. */
  advisory: Violation[];
}

export interface PackData {
  nodes: StoreNode[];
  edges: Edge[];
  aisles: Aisle[];
  sections: Section[];
  products: Product[];
  locations: ProductLocation[];
  distances: PackedDistance[];
  entranceNode: NodeId;
  checkoutNode: NodeId;
}

export interface ValidationInput {
  manifest: PackManifest;
  /** What the installer found on disk, in the staging directory. */
  staged: StagedFile[];
  pack: PackData;
  /** Products on the scheduled test lists (plan D5). */
  scheduledProducts: ProductId[];
  /** ISO date the check runs on, so freshness is testable. */
  asOf: string;
  /** Locations older than this are flagged, not rejected. Plan §3 starts at 30. */
  freshnessWindowDays: number;
}

const v = (validator: number, name: string, message: string): Violation => ({ validator, name, message });

/** 1. Every declared file is present, with a matching byte length and digest. */
export function validateIntegrity(manifest: PackManifest, staged: StagedFile[]): Violation[] {
  const found = new Map(staged.map((f) => [f.path, f]));
  const out: Violation[] = [];

  for (const declared of manifest.files) {
    const actual = found.get(declared.path);
    if (!actual) {
      out.push(v(1, 'integrity', `${declared.path} is declared in the manifest but missing from the pack`));
      continue;
    }
    if (actual.bytes !== declared.bytes) {
      out.push(v(1, 'integrity', `${declared.path} is ${actual.bytes} bytes, manifest says ${declared.bytes}`));
    }
    if (actual.sha256 !== declared.sha256) {
      out.push(v(1, 'integrity', `${declared.path} digest does not match the manifest`));
    }
  }

  // An undeclared file is also a failure: the manifest is the whole contract,
  // and a file nobody vouched for has no digest to check.
  for (const f of staged) {
    if (!manifest.files.some((d) => d.path === f.path)) {
      out.push(v(1, 'integrity', `${f.path} is in the pack but not declared in the manifest`));
    }
  }

  return out;
}

/**
 * 2. Entrance, checkout and every destination access node are mutually
 * reachable, and the graph has no isolated component.
 *
 * Fails hard. An unreachable destination would otherwise surface as a silent
 * routing failure in the aisle.
 */
export function validateConnectivity(pack: PackData, requiredNodes: NodeId[]): Violation[] {
  const ids = new Set(pack.nodes.map((n) => n.id));
  const out: Violation[] = [];

  const adjacency = new Map<NodeId, NodeId[]>(pack.nodes.map((n) => [n.id, []]));
  for (const e of pack.edges) {
    if (!ids.has(e.a) || !ids.has(e.b)) {
      out.push(v(2, 'connectivity', `edge ${e.a}-${e.b} references a node that is not in the pack`));
      continue;
    }
    adjacency.get(e.a)!.push(e.b);
    adjacency.get(e.b)!.push(e.a);
  }

  const anchors = [pack.entranceNode, pack.checkoutNode, ...requiredNodes];
  for (const id of anchors) {
    if (!ids.has(id)) out.push(v(2, 'connectivity', `required node ${id} is not in the pack`));
  }

  const start = pack.nodes[0];
  if (!start) {
    out.push(v(2, 'connectivity', 'the pack contains no nodes'));
    return out;
  }

  // One traversal answers both questions: anything unvisited is a separate
  // component, which covers the required nodes too.
  const seen = new Set<NodeId>([start.id]);
  const queue: NodeId[] = [start.id];
  while (queue.length > 0) {
    for (const next of adjacency.get(queue.pop()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  const isolated = pack.nodes.filter((n) => !seen.has(n.id));
  if (isolated.length > 0) {
    const labels = isolated.slice(0, 5).map((n) => `${n.id} (${n.label})`).join(', ');
    const more = isolated.length > 5 ? `, and ${isolated.length - 5} more` : '';
    out.push(v(2, 'connectivity', `${isolated.length} node(s) unreachable from ${start.label}: ${labels}${more}`));
  }

  return out;
}

/** 3. A finite distance entry exists for every pair among the required nodes. */
export function validateDistanceCompleteness(pack: PackData, requiredNodes: NodeId[]): Violation[] {
  const needed = [...new Set([pack.entranceNode, pack.checkoutNode, ...requiredNodes])];
  const table = new Map<string, PackedDistance>();
  for (const d of pack.distances) table.set(`${d.fromNode}:${d.toNode}`, d);

  const out: Violation[] = [];
  for (const a of needed) {
    for (const b of needed) {
      if (a === b) continue;
      const entry = table.get(`${a}:${b}`);
      if (!entry) {
        out.push(v(3, 'distances', `no precomputed distance from ${a} to ${b}`));
      } else if (!Number.isFinite(entry.metres)) {
        out.push(v(3, 'distances', `distance from ${a} to ${b} is not finite`));
      } else if (entry.path.length === 0) {
        out.push(v(3, 'distances', `distance from ${a} to ${b} carries no path`));
      }
    }
  }
  return out;
}

/** 4. Every scheduled product has at least one location with a section. */
export function validateCatalogueCoverage(pack: PackData, scheduledProducts: ProductId[]): Violation[] {
  const sectionIds = new Set(pack.sections.map((s) => s.id));
  const byProduct = new Map<ProductId, ProductLocation[]>();
  for (const l of pack.locations) {
    if (!byProduct.has(l.productId)) byProduct.set(l.productId, []);
    byProduct.get(l.productId)!.push(l);
  }
  const names = new Map(pack.products.map((p) => [p.id, p.name]));

  const out: Violation[] = [];
  for (const id of [...new Set(scheduledProducts)]) {
    const label = names.get(id) ?? `product ${id}`;
    const usable = (byProduct.get(id) ?? []).filter((l) => sectionIds.has(l.sectionId));
    if (usable.length === 0) {
      out.push(v(4, 'coverage', `${label} is on a scheduled list with no location in a known section`));
    }
  }
  return out;
}

/** 5. Every photo_path in the database resolves to a file in the pack. */
export function validatePhotoResolution(pack: PackData, photoFiles: string[]): Violation[] {
  const present = new Set(photoFiles);
  const referenced: { path: string; by: string }[] = [
    ...pack.nodes.flatMap((n) => (n.photoPath ? [{ path: n.photoPath, by: `node ${n.id}` }] : [])),
    ...pack.products.flatMap((p) => (p.photoPath ? [{ path: p.photoPath, by: `product ${p.id}` }] : [])),
  ];

  const out: Violation[] = [];
  for (const r of referenced) {
    if (!present.has(r.path)) {
      out.push(v(5, 'photos', `${r.by} references ${r.path}, which is not in the pack`));
    }
  }
  return out;
}

/**
 * 6. Advisory. Locations verified longer ago than the window are flagged so the
 * UI can say "last recorded in aisle 7" instead of stating it as fact.
 */
export function validateFreshness(pack: PackData, asOf: string, windowDays: number): Violation[] {
  const cutoff = Date.parse(asOf) - windowDays * 86_400_000;
  if (Number.isNaN(cutoff)) return [v(6, 'freshness', `asOf "${asOf}" is not a date`)];

  const names = new Map(pack.products.map((p) => [p.id, p.name]));
  const out: Violation[] = [];
  for (const l of pack.locations) {
    const at = Date.parse(l.verifiedOn);
    if (Number.isNaN(at)) {
      out.push(v(6, 'freshness', `${names.get(l.productId) ?? l.productId} has an unreadable verified_on "${l.verifiedOn}"`));
      continue;
    }
    if (at < cutoff) {
      const days = Math.floor((Date.parse(asOf) - at) / 86_400_000);
      out.push(v(6, 'freshness', `${names.get(l.productId) ?? l.productId} was last verified ${days} days ago`));
    }
  }
  return out;
}

/** All six, in order. Blocking is 1-5; advisory is 6. */
export function validatePack(input: ValidationInput): ValidationResult {
  const { manifest, staged, pack, scheduledProducts, asOf, freshnessWindowDays } = input;

  // Destination access nodes come from the scheduled products' sections.
  const sectionById = new Map(pack.sections.map((s) => [s.id, s]));
  const scheduled = new Set(scheduledProducts);
  const requiredNodes = [
    ...new Set(
      pack.locations
        .filter((l) => scheduled.has(l.productId))
        .flatMap((l) => {
          const section = sectionById.get(l.sectionId);
          return section ? [section.accessNode] : [];
        }),
    ),
  ];

  const photoFiles = manifest.files.filter((f) => f.path.startsWith('photos/')).map((f) => f.path);

  return {
    blocking: [
      ...validateIntegrity(manifest, staged),
      ...validateConnectivity(pack, requiredNodes),
      ...validateDistanceCompleteness(pack, requiredNodes),
      ...validateCatalogueCoverage(pack, scheduledProducts),
      ...validatePhotoResolution(pack, photoFiles),
    ],
    advisory: validateFreshness(pack, asOf, freshnessWindowDays),
  };
}
