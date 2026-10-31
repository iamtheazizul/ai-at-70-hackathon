// Load a served pack in the browser.
//
// The native targets read store.sqlite directly (src/pack/sqliteRows.ts). A
// browser cannot, so the builder also emits rows.json — the same rows, same
// manifest, same digests. One pack, two readers, which is the point of
// readRows being injected rather than hardcoded.
//
// Integrity is still checked here. The manifest declares a digest for
// rows.json like any other file, and Web Crypto hashes the bytes that actually
// arrived, so a truncated or substituted response is caught rather than parsed.
// Only the files this reader fetches can be checked, so store.sqlite and the
// photos are excluded from the staged set rather than silently passing.

import type { StagedFile } from '../core/pack/manifest';
import { parseManifest, type PackRows } from '../core/pack/parse';
import { toStorePack, type LoadedPack } from '../core/pack/toStorePack';
import { validatePack } from '../core/pack/validators';
import type { StorePack } from '../core/types';

/** Where a served pack lives, relative to the site root. */
export const WEB_PACK_BASE = '/pack';

const ROWS_NAME = 'rows.json';
const MANIFEST_NAME = 'manifest.json';

export interface WebPackResult {
  loaded?: LoadedPack;
  /** Why the served pack was not used. Empty when it loaded. */
  errors: string[];
  /** Validator 6, for the UI's cautious wording. */
  advisory: string[];
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fetchWebPack(
  base: string = WEB_PACK_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<WebPackResult> {
  const manifestResponse = await fetchImpl(`${base}/${MANIFEST_NAME}`).catch(() => undefined);
  if (!manifestResponse || !manifestResponse.ok) {
    return { errors: [`no pack served at ${base}`], advisory: [] };
  }

  const parsed = parseManifest(await manifestResponse.text());
  if (!parsed.value) return { errors: parsed.errors, advisory: [] };
  const manifest = parsed.value;

  const declaresRows = manifest.files.some((f) => f.path === ROWS_NAME);
  if (!declaresRows) {
    return {
      errors: [`${base} has no ${ROWS_NAME}; rebuild the pack with --json so a browser can read it`],
      advisory: [],
    };
  }

  const rowsResponse = await fetchImpl(`${base}/${ROWS_NAME}`).catch(() => undefined);
  if (!rowsResponse || !rowsResponse.ok) return { errors: [`${ROWS_NAME} could not be fetched`], advisory: [] };

  const rowsBytes = await rowsResponse.arrayBuffer();
  const staged: StagedFile[] = [{
    path: ROWS_NAME,
    sha256: await sha256Hex(rowsBytes),
    bytes: rowsBytes.byteLength,
  }];

  // Integrity before parsing, not after. Validator 1 runs again inside
  // validatePack, but by then the bytes have already been through JSON.parse;
  // bytes that fail their digest should not be parsed at all.
  const declared = manifest.files.find((f) => f.path === ROWS_NAME)!;
  const staged0 = staged[0]!;
  if (staged0.sha256 !== declared.sha256 || staged0.bytes !== declared.bytes) {
    return {
      errors: [`[1] ${ROWS_NAME} digest does not match the manifest`],
      advisory: [],
    };
  }

  let rows: PackRows;
  try {
    rows = JSON.parse(new TextDecoder().decode(rowsBytes)) as PackRows;
  } catch (e) {
    return { errors: [`${ROWS_NAME} is not valid JSON: ${(e as Error).message}`], advisory: [] };
  }

  const loaded = toStorePack(rows, manifest);
  if (!loaded.value) return { errors: loaded.errors, advisory: [] };

  // Integrity can only speak for what was fetched. Declaring the rest would
  // report every unfetched file as missing, so the manifest is narrowed to the
  // files this reader actually has in hand.
  const fetchedOnly = { ...manifest, files: manifest.files.filter((f) => f.path === ROWS_NAME) };

  const result = validatePack({
    manifest: fetchedOnly,
    staged,
    pack: {
      nodes: loaded.value.pack.nodes,
      edges: loaded.value.pack.edges,
      aisles: loaded.value.pack.aisles,
      sections: loaded.value.pack.sections,
      products: loaded.value.pack.products,
      locations: loaded.value.pack.locations,
      distances: loaded.value.distances,
      entranceNode: loaded.value.pack.entranceNode,
      checkoutNode: loaded.value.pack.checkoutNode,
    },
    scheduledProducts: rows.scheduled_product.map((r) => r.product_id as number),
    asOf: new Date().toISOString().slice(0, 10),
    freshnessWindowDays: 30,
    // Photos are not fetched up front, so photo paths cannot be resolved here.
    skipPhotoResolution: true,
  });

  if (result.blocking.length > 0) {
    return { errors: result.blocking.map((v) => `[${v.validator}] ${v.message}`), advisory: [] };
  }

  return { loaded: loaded.value, errors: [], advisory: result.advisory.map((v) => v.message) };
}

/**
 * The served pack when there is a sound one, otherwise `fallback`.
 *
 * Falling back is deliberate for the demo, and it is reported rather than
 * silent: src/mvp/remote.ts swallowing its errors is exactly how an unapplied
 * Supabase schema went unnoticed for a day.
 */
export async function resolvePack(
  fallback: StorePack,
  base: string = WEB_PACK_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<{ pack: StorePack; source: string; advisory: string[] }> {
  const result = await fetchWebPack(base, fetchImpl);
  if (result.loaded) {
    const { packId, packVersion } = result.loaded.manifest;
    const source = `pack ${packId} v${packVersion}`;
    console.info(`[pack] using ${source}`);
    for (const a of result.advisory) console.info(`[pack] advisory: ${a}`);
    return { pack: result.loaded.pack, source, advisory: result.advisory };
  }
  for (const e of result.errors) console.warn(`[pack] ${e}`);
  const source = 'bundled fixture (no served pack)';
  console.info(`[pack] using ${source}; npm run build-pack to serve a real one`);
  return { pack: fallback, source, advisory: [] };
}
