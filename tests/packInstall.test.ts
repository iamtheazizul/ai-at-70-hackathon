// The pack loader: parse manifest.json and store.sqlite into the domain types,
// then install atomically. Plan §3.
//
// Two layers here. The first builds a pack by hand with a stubbed row reader,
// so every failure path is reachable without Python or SQLite. The second
// actually runs tools/packbuild/build.py and reads the result through
// node:sqlite, and skips where either is unavailable.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assemblePack, packDirectoryName, parseManifest, type PackRows } from '../src/core/pack/parse';
import { APP_PACK_SCHEMA, installPack, stagingPath, sweepStaging } from '../src/pack/install';
import { readRowsFromSqlite, sqliteAvailable } from '../src/pack/sqliteRows';
import { fetchWebPack } from '../src/pack/webPack';
import { sampleStorePack as fixture } from '../src/data/sampleStore';
import { SCHEDULED, fixtureRows } from './helpers/fixtureRows';

const temps: string[] = [];
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'shoptimal-install-'));
  temps.push(d);
  return d;
};
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Write a staged pack whose manifest truthfully describes what is on disk. */
function stageFixturePack(packsRoot: string, overrides: Record<string, unknown> = {}): string {
  const dir = stagingPath(packsRoot, 'test');
  mkdirSync(join(dir, 'photos'), { recursive: true });

  const db = Buffer.from('not-a-real-sqlite-file');
  writeFileSync(join(dir, 'store.sqlite'), db);
  const files = [{ path: 'store.sqlite', sha256: sha(db), bytes: db.byteLength }];

  const photos = [...new Set([
    ...fixture.nodes.flatMap((n) => (n.photoPath ? [n.photoPath] : [])),
    ...fixture.products.flatMap((p) => (p.photoPath ? [p.photoPath] : [])),
  ])];
  for (const p of photos) {
    const body = Buffer.from(`fake-${p}`);
    writeFileSync(join(dir, p), body);
    files.push({ path: p, sha256: sha(body), bytes: body.byteLength });
  }

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    pack_id: 'sample-store',
    pack_version: 1,
    layout_version: '2026-10',
    built_at: '2026-10-30T00:00:00Z',
    surveyed_between: ['2026-10-27', '2026-10-27'],
    store: { id: 1, name: fixture.storeName },
    counts: { nodes: 18, edges: 24, products: 14, locations: 14, photos: photos.length },
    requires: { min_app_schema: APP_PACK_SCHEMA, recognition: ['text', 'barcode'] },
    files,
    ...overrides,
  }, null, 2));

  return dir;
}

const install = (packsRoot: string, stagingDir: string, asOf = '2026-11-10') =>
  installPack({ stagingDir, packsRoot, readRows: async () => fixtureRows(), asOf });

describe('parseManifest', () => {
  it('maps snake_case on disk to the camelCase the core uses', () => {
    const root = temp();
    const dir = stageFixturePack(root);
    const parsed = parseManifest(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(parsed.errors).toEqual([]);
    expect(parsed.value!.packId).toBe('sample-store');
    expect(parsed.value!.requires.minAppSchema).toBe(APP_PACK_SCHEMA);
    expect(parsed.value!.files.length).toBe(32);
  });

  it('reports unreadable JSON rather than throwing', () => {
    expect(parseManifest('{not json').errors[0]).toContain('not valid JSON');
  });

  it('names each missing field', () => {
    const { errors } = parseManifest(JSON.stringify({ pack_id: 'x' }));
    expect(errors.some((e) => e.includes('pack_version'))).toBe(true);
    expect(errors.some((e) => e.includes('store.name'))).toBe(true);
    expect(errors.some((e) => e.includes('files'))).toBe(true);
  });

  it('rejects a file entry with no digest', () => {
    const { errors } = parseManifest(JSON.stringify({
      pack_id: 'x', pack_version: 1, layout_version: 'v', built_at: 'now',
      surveyed_between: ['a', 'b'], store: { id: 1, name: 'n' },
      files: [{ path: 'store.sqlite', bytes: 1 }],
    }));
    expect(errors.some((e) => e.includes('files[0]'))).toBe(true);
  });
});

describe('assemblePack', () => {
  it('turns 1/0 into booleans and SQL NULL into absent', () => {
    const pack = assemblePack(fixtureRows()).value!;
    expect(pack.aisles.find((a) => a.id === 7)!.isCold).toBe(true);
    expect(pack.aisles.find((a) => a.id === 1)!.isCold).toBe(false);
    expect(pack.edges[0]!.measured).toBe(true);
    // The entrance has no aisle, so the field is absent rather than null.
    expect(pack.nodes.find((n) => n.id === 1)!.aisleId).toBeUndefined();
  });

  it('rebuilds each aisle ends list from the nodes', () => {
    const pack = assemblePack(fixtureRows()).value!;
    expect(pack.aisles.find((a) => a.id === 3)!.ends.sort()).toEqual([13, 23]);
  });

  it('finds the entrance and checkout by kind', () => {
    const pack = assemblePack(fixtureRows()).value!;
    expect(pack.entranceNode).toBe(1);
    expect(pack.checkoutNode).toBe(2);
  });

  it('refuses a pack with no entrance', () => {
    const rows = fixtureRows();
    rows.node = rows.node.filter((n) => n.kind !== 'entrance');
    expect(assemblePack(rows).errors.some((e) => e.includes('entrance'))).toBe(true);
  });

  it('reports a node_distance row whose path is unreadable', () => {
    const rows = fixtureRows();
    rows.node_distance[0] = { ...rows.node_distance[0]!, path_json: '[1,' };
    expect(assemblePack(rows).errors[0]).toContain('unreadable path_json');
  });
});

describe('installPack', () => {
  let root: string;
  beforeEach(() => { root = temp(); });

  it('renames the staging directory into place and writes the pointer', async () => {
    const staging = stageFixturePack(root);
    const result = await install(root, staging);

    expect(result.errors).toEqual([]);
    expect(result.blocking).toEqual([]);
    expect(result.installed).toBe(true);
    expect(result.path).toBe(join(root, 'sample-store-v1'));
    // Atomic: the staging directory is gone, the final name is there.
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(join(root, 'sample-store-v1', 'store.sqlite'))).toBe(true);

    const pointer = JSON.parse(readFileSync(join(root, 'installed.json'), 'utf8'));
    expect(pointer.current).toBe('sample-store-v1');
    expect(pointer.advisory).toEqual([]);
  });

  it('refuses a tampered file and leaves nothing selectable', async () => {
    const staging = stageFixturePack(root);
    writeFileSync(join(staging, 'photos/aisle-3-front.webp'), 'tampered');

    const result = await install(root, staging);
    expect(result.installed).toBe(false);
    expect(result.blocking.some((v) => v.validator === 1)).toBe(true);
    expect(existsSync(join(root, 'sample-store-v1'))).toBe(false);
    // The staging directory goes too, so a retry starts clean.
    expect(existsSync(staging)).toBe(false);
  });

  it('refuses a pack that needs a newer app', async () => {
    const staging = stageFixturePack(root, { requires: { min_app_schema: APP_PACK_SCHEMA + 1, recognition: [] } });
    const result = await install(root, staging);
    expect(result.installed).toBe(false);
    expect(result.errors[0]).toContain(`needs app pack schema ${APP_PACK_SCHEMA + 1}`);
  });

  it('refuses to reinstall a version, because packs are immutable', async () => {
    expect((await install(root, stageFixturePack(root))).installed).toBe(true);
    const again = await install(root, stageFixturePack(root));
    expect(again.installed).toBe(false);
    expect(again.errors[0]).toContain('already installed');
  });

  it('stores validator 6 in the pointer instead of blocking on it', async () => {
    const staging = stageFixturePack(root);
    const result = await install(root, staging, '2027-06-01');
    expect(result.installed).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.advisory.length).toBe(fixture.locations.length);
    expect(JSON.parse(readFileSync(join(root, 'installed.json'), 'utf8')).advisory.length).toBe(fixture.locations.length);
  });

  it('reports a missing manifest rather than crashing', async () => {
    const staging = stagingPath(root, 'empty');
    mkdirSync(staging, { recursive: true });
    expect((await install(root, staging)).errors[0]).toContain('manifest.json is missing');
  });
});

describe('sweepStaging', () => {
  it('deletes interrupted downloads and leaves installed packs alone', async () => {
    const root = temp();
    expect((await install(root, stageFixturePack(root))).installed).toBe(true);
    mkdirSync(stagingPath(root, 'interrupted'), { recursive: true });

    expect(await sweepStaging(root)).toEqual(['.staging-interrupted']);
    expect(existsSync(stagingPath(root, 'interrupted'))).toBe(false);
    expect(existsSync(join(root, 'sample-store-v1'))).toBe(true);
  });

  it('is quiet when the packs root does not exist yet', async () => {
    expect(await sweepStaging(join(temp(), 'never-created'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
const python = spawnSync('python3', ['--version']);
const hasPython = python.status === 0;
// Asks the production code, so the gate cannot drift from what the reader does.
const hasSqlite = sqliteAvailable();

describe('end to end preconditions', () => {
  it('has python3 and node:sqlite when running in CI', () => {
    // Skipping locally on an old runtime is fine. Skipping in CI is not: it
    // would leave the pack loader untested while the run stayed green, which
    // is how the Vite import bug hid in the first place.
    if (!process.env.CI) return;
    expect(hasPython, 'python3 is required to run tools/packbuild in CI').toBe(true);
    expect(hasSqlite, 'node:sqlite is required to read store.sqlite in CI').toBe(true);
  });
});

describe.skipIf(!hasPython || !hasSqlite)('end to end through tools/packbuild', () => {
  it('builds a pack, reads its sqlite, and installs it', async () => {
    const work = temp();
    const rowsPath = join(work, 'rows.json');

    const exported = spawnSync('node', ['scripts/export-rows.mjs', rowsPath], { encoding: 'utf8' });
    expect(exported.status, exported.stderr).toBe(0);

    const photos = join(work, 'photos');
    mkdirSync(photos, { recursive: true });
    const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
    const referenced: string[] = [...new Set(
      [...rows.nodes, ...rows.products].map((r: { photo_path: string | null }) => r.photo_path).filter(Boolean),
    )] as string[];
    for (const p of referenced) writeFileSync(join(photos, p.split('/').pop()!), `fake-${p}`);

    const packsRoot = join(work, 'packs');
    const staging = stagingPath(packsRoot, 'e2e');
    const built = spawnSync('python3', ['tools/packbuild/build.py', rowsPath, staging, '--photos', photos], { encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);

    const result = await installPack({
      stagingDir: staging,
      packsRoot,
      readRows: readRowsFromSqlite,
      asOf: '2026-11-10',
    });

    expect(result.errors).toEqual([]);
    expect(result.blocking).toEqual([]);
    expect(result.advisory).toEqual([]);
    expect(result.installed).toBe(true);

    // The installed pack reads back as the fixture it was built from.
    const reread = assemblePack(await readRowsFromSqlite(join(result.path!, 'store.sqlite'))).value!;
    expect(reread.nodes.length).toBe(fixture.nodes.length);
    expect(reread.edges.length).toBe(fixture.edges.length);
    expect(reread.products.length).toBe(fixture.products.length);
    expect(reread.distances.length).toBe(fixture.nodes.length * (fixture.nodes.length - 1));
    expect(reread.nodes.find((n) => n.id === 1)!.xMetres).toBe(0);
    expect(packDirectoryName({ packId: rows.pack_id, packVersion: rows.pack_version } as never)).toBe('sample-store-v1');
  });

  it('builds a browser-readable pack and loads it through the web reader', async () => {
    const work = temp();
    const rowsPath = join(work, 'rows.json');
    expect(spawnSync('node', ['scripts/export-rows.mjs', rowsPath], { encoding: 'utf8' }).status).toBe(0);

    const out = join(work, 'webpack');
    const built = spawnSync(
      'python3',
      ['tools/packbuild/build.py', rowsPath, out, '--json', '--no-photos'],
      { encoding: 'utf8' },
    );
    expect(built.status, built.stderr).toBe(0);

    // Serve the built directory to the reader exactly as the dev server would.
    const serveDir: typeof fetch = (async (url: string | URL) => {
      const name = String(url).split('/').pop()!;
      const file = join(out, name);
      if (!existsSync(file)) return { ok: false, status: 404 } as Response;
      const body = readFileSync(file);
      return {
        ok: true,
        status: 200,
        text: async () => body.toString('utf8'),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await fetchWebPack('/pack', serveDir);
    expect(result.errors).toEqual([]);
    expect(result.loaded).toBeDefined();

    const { pack, distances } = result.loaded!;
    expect(pack.nodes.length).toBe(fixture.nodes.length);
    expect(pack.edges.length).toBe(fixture.edges.length);
    expect(Object.keys(pack.barcodes).length).toBe(Object.keys(fixture.barcodes).length);
    expect(distances.length).toBe(fixture.nodes.length * (fixture.nodes.length - 1));
    // --no-photos dropped the paths, so nothing references a file the pack lacks.
    expect(pack.nodes.every((n) => n.photoPath === undefined)).toBe(true);

    // The digest in the manifest is the digest of the bytes on disk: tamper and
    // the reader refuses it.
    writeFileSync(join(out, 'rows.json'), `${readFileSync(join(out, 'rows.json'), 'utf8')}\n`);
    const tampered = await fetchWebPack('/pack', serveDir);
    expect(tampered.loaded).toBeUndefined();
    expect(tampered.errors.join(' ')).toContain('digest does not match');
  });
});
