// The browser pack reader. It fetches manifest.json and rows.json, verifies the
// digest of what actually arrived, and either hands back a StorePack or says
// why it would not.
//
// Every case here runs against a stub fetch, so no dev server and no built pack
// is needed. The counterpart in packInstall.test.ts runs the same reader over a
// pack that tools/packbuild actually produced.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { fetchWebPack, resolvePack } from '../src/pack/webPack';
import { sampleStorePack as fixture } from '../src/data/sampleStore';
import { SCHEDULED, fixtureRows } from './helpers/fixtureRows';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

interface ServedPack {
  manifest?: unknown;
  rows?: string;
}

/** A fetch that serves only what the test puts in it. */
function serve({ manifest, rows }: ServedPack): typeof fetch {
  return (async (url: string | URL) => {
    const path = String(url);
    const body = path.endsWith('manifest.json')
      ? manifest === undefined ? undefined : JSON.stringify(manifest)
      : path.endsWith('rows.json') ? rows : undefined;
    if (body === undefined) return { ok: false, status: 404 } as Response;
    return {
      ok: true,
      status: 200,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    } as Response;
  }) as unknown as typeof fetch;
}

function soundPack(): ServedPack {
  const rows = JSON.stringify(fixtureRows());
  return {
    rows,
    manifest: {
      pack_id: 'sample-store',
      pack_version: 1,
      layout_version: '2026-10',
      built_at: '2026-10-30T00:00:00Z',
      surveyed_between: ['2026-10-27', '2026-10-27'],
      store: { id: 1, name: fixture.storeName },
      counts: { nodes: 18, edges: 24, products: 14, locations: 14, photos: 0 },
      requires: { min_app_schema: 3, recognition: ['text', 'barcode'] },
      files: [
        { path: 'rows.json', sha256: sha(rows), bytes: new TextEncoder().encode(rows).byteLength },
        { path: 'store.sqlite', sha256: 'not-fetched-by-a-browser', bytes: 65536 },
      ],
    },
  };
}

describe('fetchWebPack', () => {
  it('loads a sound pack into a StorePack', async () => {
    const result = await fetchWebPack('/pack', serve(soundPack()));
    expect(result.errors).toEqual([]);
    expect(result.loaded).toBeDefined();

    const { pack, distances, manifest } = result.loaded!;
    expect(manifest.packId).toBe('sample-store');
    expect(pack.storeName).toBe(fixture.storeName);
    expect(pack.nodes.length).toBe(fixture.nodes.length);
    expect(pack.products.length).toBe(fixture.products.length);
    // Barcodes come from product_barcode, which assemblePack does not carry.
    expect(Object.keys(pack.barcodes).length).toBe(Object.keys(fixture.barcodes).length);
    expect(pack.barcodes['4011000000001']).toBe(1);
    // The coordinates survive the round trip through JSON.
    expect(pack.nodes.find((n) => n.id === 1)!.xMetres).toBe(0);
    expect(distances.length).toBe(fixture.nodes.length * (fixture.nodes.length - 1));
  });

  it('ignores store.sqlite rather than reporting it missing', async () => {
    // A browser never fetches it, so integrity can only speak for rows.json.
    const result = await fetchWebPack('/pack', serve(soundPack()));
    expect(result.errors).toEqual([]);
  });

  it('rejects rows.json whose bytes do not match the declared digest', async () => {
    // Still valid JSON, one byte longer. A mutation that broke the JSON would
    // prove the parse path rather than the digest check.
    const served = soundPack();
    served.rows = `${served.rows!}\n`;
    const result = await fetchWebPack('/pack', serve(served));
    expect(result.loaded).toBeUndefined();
    expect(result.errors.join(' ')).toContain('digest does not match');
  });

  it('does not parse rows.json at all when its digest is wrong', async () => {
    // Bytes that fail integrity are never handed to JSON.parse, so a corrupt
    // body reports the tamper rather than a syntax error.
    const served = soundPack();
    served.rows = 'this is not json at all';
    const result = await fetchWebPack('/pack', serve(served));
    expect(result.errors.join(' ')).toContain('digest does not match');
    expect(result.errors.join(' ')).not.toContain('not valid JSON');
  });

  it('says nothing is served when the manifest is absent', async () => {
    const result = await fetchWebPack('/pack', serve({}));
    expect(result.errors[0]).toContain('no pack served');
  });

  it('asks for a rebuild when the pack has no rows.json', async () => {
    const served = soundPack();
    (served.manifest as { files: unknown[] }).files = [
      { path: 'store.sqlite', sha256: 'x', bytes: 1 },
    ];
    const result = await fetchWebPack('/pack', serve(served));
    expect(result.errors[0]).toContain('--json');
  });

  it('reports unreadable rows.json that passes its digest', async () => {
    const broken = '{"store":[';
    const result = await fetchWebPack('/pack', serve({
      rows: broken,
      manifest: {
        ...(soundPack().manifest as Record<string, unknown>),
        files: [{ path: 'rows.json', sha256: sha(broken), bytes: broken.length }],
      },
    }));
    expect(result.errors[0]).toContain('not valid JSON');
  });

  it('refuses a pack whose graph is cut, naming the validator', async () => {
    const rowsObject = fixtureRows();
    rowsObject.edge = rowsObject.edge.filter((e) => ![18, 28].includes(e.a_node as number) && ![18, 28].includes(e.b_node as number));
    const rows = JSON.stringify(rowsObject);
    const result = await fetchWebPack('/pack', serve({
      rows,
      manifest: {
        ...(soundPack().manifest as Record<string, unknown>),
        files: [{ path: 'rows.json', sha256: sha(rows), bytes: new TextEncoder().encode(rows).byteLength }],
      },
    }));
    expect(result.loaded).toBeUndefined();
    expect(result.errors.join(' ')).toContain('[2]');
  });
});

describe('resolvePack', () => {
  it('prefers a served pack and names it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { pack, source } = await resolvePack(fixture, '/pack', serve(soundPack()));
    expect(source).toBe('pack sample-store v1');
    expect(pack.packId).toBe('sample-store');
    info.mockRestore();
  });

  it('falls back to the fixture and says so out loud', async () => {
    // Silence here is the failure mode that hid the unapplied Supabase schema,
    // so the fallback has to be audible.
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { pack, source } = await resolvePack(fixture, '/pack', serve({}));
    expect(pack).toBe(fixture);
    expect(source).toContain('bundled fixture');
    expect(warn).toHaveBeenCalled();
    expect(info.mock.calls.flat().join(' ')).toContain('build-pack');

    info.mockRestore();
    warn.mockRestore();
  });

  it('falls back rather than running a trip on a pack that failed validation', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const served = soundPack();
    served.rows = `${served.rows!.slice(0, -1)} `;

    const { pack } = await resolvePack(fixture, '/pack', serve(served));
    expect(pack).toBe(fixture);
    expect(SCHEDULED.length).toBeGreaterThan(0);

    info.mockRestore();
    warn.mockRestore();
  });
});
