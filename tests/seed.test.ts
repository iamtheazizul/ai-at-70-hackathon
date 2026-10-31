// Holds supabase/migrations/0002_seed_sample_store.sql to its schema and to the
// fixture it was generated from.
//
// There is no Postgres in CI, so this is what stands in for applying the
// migration: it parses 0001 for the shape of each table, then checks the seed
// against it. The last test is the one that matters most in practice — it fails
// if someone edits the fixture and forgets `npm run gen-seed`, which is exactly
// how generated SQL silently goes stale.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleStorePack as pack } from '../src/data/sampleStore';

const read = (name: string): string =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

const schemaSql = read('0001_store_graph.sql');
const seedSql = read('0002_seed_sample_store.sql');

/** table -> column names, from `create table if not exists X ( ... );` */
const tables = new Map<string, Set<string>>();
for (const m of schemaSql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
  const cols = new Set<string>();
  for (const line of m[2]!.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('--')) continue;
    const word = t.split(/[\s(]/)[0]!;
    if (['unique', 'check', 'primary', 'foreign', 'constraint', 'references'].includes(word.toLowerCase())) continue;
    cols.add(word);
  }
  tables.set(m[1]!, cols);
}

/**
 * `check (col in ('a','b'))` -> allowed values, keyed `table.column`.
 *
 * Keyed by table as well as column because `source` exists twice with
 * different vocabularies: product_location.source is survey/staff/
 * observation_reviewed, location_observation.source is shopper/team. Keying on
 * the column alone silently let the second overwrite the first.
 */
const enums = new Map<string, Set<string>>();
for (const [table, , body] of [...schemaSql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)]
  .map((m) => [m[1]!, null, m[2]!] as const)) {
  for (const c of body.matchAll(/check \((\w+) in\s*\(([^)]*)\)\)/g)) {
    enums.set(`${table}.${c[1]!}`, new Set([...c[2]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!)));
  }
}

/** Every `insert into X (a, b, c)` in the seed. */
const inserts = [...seedSql.matchAll(/insert into (\w+) \(([^)]*)\)/g)].map((m) => ({
  table: m[1]!,
  columns: m[2]!.split(',').map((c) => c.trim()),
}));

describe('seed migration', () => {
  it('parsed both migrations', () => {
    expect(tables.size).toBe(11);
    expect(inserts.length).toBeGreaterThan(0);
  });

  it('only inserts into tables the schema creates', () => {
    const unknown = inserts.filter((i) => !tables.has(i.table)).map((i) => i.table);
    expect(unknown).toEqual([]);
  });

  it('only inserts columns those tables have', () => {
    const bad: string[] = [];
    for (const i of inserts) {
      const cols = tables.get(i.table);
      if (!cols) continue;
      for (const c of i.columns) if (!cols.has(c)) bad.push(`${i.table}.${c}`);
    }
    expect(bad).toEqual([]);
  });

  it('uses only values the schema check constraints permit', () => {
    const bad: string[] = [];
    const check = (key: string, values: string[]): void => {
      const allowed = enums.get(key);
      // A missing key means the regex stopped matching the schema, not that
      // there is nothing to check. Fail rather than pass silently.
      expect(allowed, `no check constraint parsed for ${key}`).toBeDefined();
      for (const v of values) if (allowed && !allowed.has(v)) bad.push(`${key}=${v}`);
    };
    check('node.kind', pack.nodes.map((n) => n.kind));
    check('section.side', pack.sections.map((s) => s.side));
    check('product_location.source', pack.locations.map((l) => l.source));
    check('product_location.review_status', pack.locations.map((l) => l.reviewStatus));
    check('product_location.shelf_level', pack.locations.flatMap((l) => (l.shelfLevel ? [l.shelfLevel] : [])));
    expect(bad).toEqual([]);
  });

  it('keeps every foreign key inside the rows it inserts', () => {
    // Nothing else is in the database when this runs, so a reference to a row
    // the seed does not create is a foreign key violation on apply.
    const nodeIds = new Set(pack.nodes.map((n) => n.id));
    const aisleIds = new Set(pack.aisles.map((a) => a.id));
    const sectionIds = new Set(pack.sections.map((s) => s.id));
    const productIds = new Set(pack.products.map((p) => p.id));
    const dangling: string[] = [];

    for (const e of pack.edges) {
      if (!nodeIds.has(e.a)) dangling.push(`edge.a_node ${e.a}`);
      if (!nodeIds.has(e.b)) dangling.push(`edge.b_node ${e.b}`);
      // The table stores each undirected edge once under check (a_node < b_node).
      if (e.a === e.b) dangling.push(`edge is a self-loop at ${e.a}`);
    }
    for (const a of pack.aisles) {
      if (!nodeIds.has(a.referenceEndNode)) dangling.push(`aisle.reference_end_node ${a.referenceEndNode}`);
    }
    for (const s of pack.sections) {
      if (!aisleIds.has(s.aisleId)) dangling.push(`section.aisle_id ${s.aisleId}`);
      if (!nodeIds.has(s.accessNode)) dangling.push(`section.access_node ${s.accessNode}`);
    }
    for (const n of pack.nodes) {
      if (n.aisleId !== undefined && !aisleIds.has(n.aisleId)) dangling.push(`node.aisle_id ${n.aisleId}`);
    }
    for (const l of pack.locations) {
      if (!productIds.has(l.productId)) dangling.push(`product_location.product_id ${l.productId}`);
      if (!sectionIds.has(l.sectionId)) dangling.push(`product_location.section_id ${l.sectionId}`);
    }
    for (const id of Object.values(pack.barcodes)) {
      if (!productIds.has(id)) dangling.push(`product_barcode.product_id ${id}`);
    }
    expect(dangling).toEqual([]);
  });

  it('is regenerated whenever the fixture changes', () => {
    // Counts the value tuples per insert and compares them with the fixture.
    // Edit src/data/sampleStore.ts without running `npm run gen-seed` and this
    // is the test that says so.
    const tupleCount = (table: string): number => {
      const start = seedSql.indexOf(`insert into ${table} (`);
      expect(start, `no insert into ${table}`).toBeGreaterThan(-1);
      const end = seedSql.indexOf(';', start);
      return [...seedSql.slice(start, end).matchAll(/^ {2}\(/gm)].length;
    };
    expect(tupleCount('node')).toBe(pack.nodes.length);
    expect(tupleCount('edge')).toBe(pack.edges.length);
    expect(tupleCount('aisle')).toBe(pack.aisles.length);
    expect(tupleCount('section')).toBe(pack.sections.length);
    expect(tupleCount('product')).toBe(pack.products.length);
    expect(tupleCount('product_barcode')).toBe(Object.keys(pack.barcodes).length);
    expect(tupleCount('product_location')).toBe(pack.locations.length);
    expect(tupleCount('aisle_sign_variant')).toBe(pack.aisles.reduce((t, a) => t + a.signVariants.length, 0));
  });
});
