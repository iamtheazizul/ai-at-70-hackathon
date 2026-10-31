// The six install validators from plan §3. FR-03's proving test is "six
// validators unit-tested", so each one gets a pass case and a failure case, and
// the failure case asserts the message names what is missing — a pack that
// fails without saying why is the thing the shopper cannot act on.
import { describe, expect, it } from 'vitest';
import { buildDistanceMatrix } from '../src/core/route/distance';
import type { PackManifest, PackedDistance, StagedFile } from '../src/core/pack/manifest';
import type { Edge, StoreNode } from '../src/core/types';
import type { PackData } from '../src/core/pack/validators';
import {
  validateCatalogueCoverage,
  validateConnectivity,
  validateDistanceCompleteness,
  validateFreshness,
  validateIntegrity,
  validatePack,
  validatePhotoResolution,
} from '../src/core/pack/validators';
import { sampleList, sampleStorePack } from '../src/data/sampleStore';

const SCHEDULED = [...new Set(sampleList.flatMap((e) => e.acceptedProducts))];

/**
 * Precompute node_distance the way tools/packbuild/build.py does: every pair
 * with a finite distance, unreachable pairs simply absent.
 *
 * Tests that change the edges must call this again. A pack's distance table is
 * built from its own edges, so leaving the old table in place would be testing
 * a pack no builder could produce — and validator 3, which checks the packed
 * table rather than recomputing from edges, would read the stale rows as sound.
 */
const withDistances = <T extends { nodes: StoreNode[]; edges: Edge[] }>(pack: T): T & { distances: PackedDistance[] } => {
  const dist = buildDistanceMatrix(pack.nodes, pack.edges);
  const distances: PackedDistance[] = [];
  for (const a of dist.nodes) {
    for (const b of dist.nodes) {
      if (a === b) continue;
      const metres = dist.metres(a, b);
      if (!Number.isFinite(metres)) continue;
      distances.push({ fromNode: a, toNode: b, metres, path: dist.path(a, b) });
    }
  }
  return { ...pack, distances };
};

const basePack = (): PackData => withDistances({
  nodes: sampleStorePack.nodes.map((n) => ({ ...n })),
  edges: sampleStorePack.edges.map((e) => ({ ...e })),
  aisles: sampleStorePack.aisles,
  sections: sampleStorePack.sections,
  products: sampleStorePack.products,
  locations: sampleStorePack.locations.map((l) => ({ ...l })),
  entranceNode: sampleStorePack.entranceNode,
  checkoutNode: sampleStorePack.checkoutNode,
});

/** Photo paths the pack's rows reference, as manifest entries. */
const photoFiles = (pack: PackData): StagedFile[] =>
  [...new Set([
    ...pack.nodes.flatMap((n) => (n.photoPath ? [n.photoPath] : [])),
    ...pack.products.flatMap((p) => (p.photoPath ? [p.photoPath] : [])),
  ])].map((path, i) => ({ path, sha256: `photo${i}`, bytes: 100 + i }));

const baseManifest = (pack: PackData): PackManifest => ({
  packId: 'sample-store',
  packVersion: 1,
  layoutVersion: '2026-10',
  builtAt: '2026-10-30T00:00:00Z',
  surveyedBetween: ['2026-10-27', '2026-10-27'],
  store: { id: 1, name: 'Sample Store (fixture)' },
  counts: { nodes: pack.nodes.length, edges: pack.edges.length, products: pack.products.length, locations: pack.locations.length, photos: photoFiles(pack).length },
  requires: { minAppSchema: 3, recognition: ['text', 'barcode'] },
  files: [{ path: 'store.sqlite', sha256: 'db-digest', bytes: 65536 }, ...photoFiles(pack)],
});

const stagedFor = (m: PackManifest): StagedFile[] => m.files.map((f) => ({ ...f }));

describe('1. integrity', () => {
  it('passes when every declared file is present and matches', () => {
    const pack = basePack();
    const m = baseManifest(pack);
    expect(validateIntegrity(m, stagedFor(m))).toEqual([]);
  });

  it('names a declared file that is missing', () => {
    const pack = basePack();
    const m = baseManifest(pack);
    const staged = stagedFor(m).filter((f) => f.path !== 'store.sqlite');
    const out = validateIntegrity(m, staged);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('store.sqlite');
    expect(out[0]!.message).toContain('missing');
  });

  it('catches a digest mismatch and a length mismatch separately', () => {
    const pack = basePack();
    const m = baseManifest(pack);
    const staged = stagedFor(m);
    staged[0] = { ...staged[0]!, sha256: 'tampered', bytes: 1 };
    const out = validateIntegrity(m, staged);
    expect(out.map((x) => x.message.includes('digest'))).toContain(true);
    expect(out.map((x) => x.message.includes('bytes'))).toContain(true);
  });

  it('rejects a file nobody declared, because it has no digest to check', () => {
    const pack = basePack();
    const m = baseManifest(pack);
    const out = validateIntegrity(m, [...stagedFor(m), { path: 'photos/stowaway.webp', sha256: 'x', bytes: 9 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('stowaway');
  });
});

describe('2. graph connectivity', () => {
  it('passes on the fixture', () => {
    expect(validateConnectivity(basePack(), [])).toEqual([]);
  });

  it('names the nodes left in a separate component', () => {
    const pack = basePack();
    // Cut aisle 8 off entirely: drop every edge that touches either of its ends.
    pack.edges = pack.edges.filter((e) => ![18, 28].includes(e.a) && ![18, 28].includes(e.b));
    const out = validateConnectivity(pack, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('unreachable');
    expect(out[0]!.message).toContain('18');
  });

  it('reports a required node that is not in the pack at all', () => {
    const out = validateConnectivity(basePack(), [999]);
    expect(out.some((x) => x.message.includes('999'))).toBe(true);
  });

  it('reports an edge pointing at a node that does not exist', () => {
    const pack = basePack();
    pack.edges = [...pack.edges, { a: 11, b: 777, metres: 4, measured: true }];
    expect(validateConnectivity(pack, []).some((x) => x.message.includes('777'))).toBe(true);
  });
});

describe('3. distance matrix completeness', () => {
  it('passes when every required pair has a finite distance and a path', () => {
    const pack = basePack();
    const required = pack.sections.map((s) => s.accessNode);
    expect(validateDistanceCompleteness(pack, required)).toEqual([]);
  });

  it('names the pair whose entry is missing', () => {
    const pack = basePack();
    pack.distances = pack.distances.filter((d) => !(d.fromNode === 1 && d.toNode === 2));
    const out = validateDistanceCompleteness(pack, [1, 2]);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('from 1 to 2');
  });

  it('rejects an entry with no path, which would break leg instructions', () => {
    const pack = basePack();
    pack.distances = pack.distances.map((d) =>
      d.fromNode === 1 && d.toNode === 2 ? { ...d, path: [] } : d,
    );
    expect(validateDistanceCompleteness(pack, [1, 2])[0]!.message).toContain('no path');
  });
});

describe('4. catalogue coverage', () => {
  it('passes for every product the scheduled lists ask for', () => {
    expect(validateCatalogueCoverage(basePack(), SCHEDULED)).toEqual([]);
  });

  it('names the product by name, not just id', () => {
    const pack = basePack();
    pack.locations = pack.locations.filter((l) => l.productId !== 10);
    const out = validateCatalogueCoverage(pack, SCHEDULED);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('Orange juice');
  });

  it('does not count a location pointing at a section the pack lacks', () => {
    const pack = basePack();
    pack.locations = pack.locations.map((l) => (l.productId === 10 ? { ...l, sectionId: 9999 } : l));
    expect(validateCatalogueCoverage(pack, SCHEDULED)[0]!.message).toContain('Orange juice');
  });
});

describe('5. photo resolution', () => {
  it('passes when every referenced photo is in the pack', () => {
    const pack = basePack();
    expect(validatePhotoResolution(pack, photoFiles(pack).map((f) => f.path))).toEqual([]);
  });

  it('names the row that references a photo the pack has not got', () => {
    const pack = basePack();
    const present = photoFiles(pack).map((f) => f.path).filter((p) => p !== 'photos/entrance.webp');
    const out = validatePhotoResolution(pack, present);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('photos/entrance.webp');
    expect(out[0]!.message).toContain('node 1');
  });

  it('passes a pack built with no photos at all', () => {
    const pack = basePack();
    pack.nodes = pack.nodes.map((n) => ({ ...n, photoPath: undefined }));
    pack.products = pack.products.map((p) => ({ ...p, photoPath: undefined }));
    expect(validatePhotoResolution(pack, [])).toEqual([]);
  });
});

describe('6. freshness (advisory)', () => {
  it('says nothing while locations are inside the window', () => {
    expect(validateFreshness(basePack(), '2026-11-10', 30)).toEqual([]);
  });

  it('flags stale locations with how old they are, and never blocks', () => {
    const pack = basePack();
    const out = validateFreshness(pack, '2027-01-01', 30);
    expect(out).toHaveLength(pack.locations.length);
    expect(out[0]!.message).toMatch(/last verified \d+ days ago/);

    const result = validatePack({
      manifest: baseManifest(pack),
      staged: stagedFor(baseManifest(pack)),
      pack,
      scheduledProducts: SCHEDULED,
      asOf: '2027-01-01',
      freshnessWindowDays: 30,
    });
    expect(result.advisory.length).toBeGreaterThan(0);
    expect(result.blocking).toEqual([]);
  });

  it('reports an unreadable date rather than treating it as fresh', () => {
    const pack = basePack();
    pack.locations = [{ ...pack.locations[0]!, verifiedOn: 'last tuesday' }];
    expect(validateFreshness(pack, '2026-11-01', 30)[0]!.message).toContain('unreadable');
  });
});

describe('validatePack', () => {
  it('says which validators ran, so a skipped one is not read as a pass', () => {
    // A browser reader has not fetched the photos, so validator 5 cannot run.
    // It must be visible in the result rather than inferred from silence.
    const pack = basePack();
    const manifest = baseManifest(pack);
    const args = {
      manifest,
      staged: stagedFor(manifest),
      pack,
      scheduledProducts: SCHEDULED,
      asOf: '2026-11-10',
      freshnessWindowDays: 30,
    };
    expect(validatePack(args).ran).toEqual([1, 2, 3, 4, 5, 6]);
    expect(validatePack({ ...args, skipPhotoResolution: true }).ran).toEqual([1, 2, 3, 4, 6]);

    // And skipping it really does suppress a failure it would otherwise raise.
    const broken = basePack();
    broken.nodes = broken.nodes.map((n) => (n.id === 1 ? { ...n, photoPath: 'photos/gone.webp' } : n));
    const brokenArgs = { ...args, pack: broken };
    expect(validatePack(brokenArgs).blocking.some((v) => v.validator === 5)).toBe(true);
    expect(validatePack({ ...brokenArgs, skipPhotoResolution: true }).blocking).toEqual([]);
  });

  it('installs a sound pack: nothing blocking, nothing advisory', () => {
    const pack = basePack();
    const manifest = baseManifest(pack);
    const result = validatePack({
      manifest,
      staged: stagedFor(manifest),
      pack,
      scheduledProducts: SCHEDULED,
      asOf: '2026-11-10',
      freshnessWindowDays: 30,
    });
    expect(result).toEqual({ blocking: [], advisory: [], ran: [1, 2, 3, 4, 5, 6] });
  });

  it('derives the required nodes from the scheduled products own sections', () => {
    // Orange juice sits in aisle 6; cutting that aisle off must be caught as a
    // connectivity failure rather than passing because the rest of the store is
    // fine.
    const base = basePack();
    const pack = withDistances({
      ...base,
      edges: base.edges.filter((e) => ![16, 26].includes(e.a) && ![16, 26].includes(e.b)),
    });
    const manifest = baseManifest(pack);
    const result = validatePack({
      manifest,
      staged: stagedFor(manifest),
      pack,
      scheduledProducts: SCHEDULED,
      asOf: '2026-11-10',
      freshnessWindowDays: 30,
    });
    expect(result.blocking.some((x) => x.validator === 2)).toBe(true);
    expect(result.blocking.some((x) => x.validator === 3)).toBe(true);
  });
});
