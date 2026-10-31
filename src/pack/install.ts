// Install a store pack. Plan §3: "Install is atomic or it did not happen."
//
//   download into packs/.staging-<uuid>/
//     -> digest every file the manifest declares
//     -> run the six validators
//     -> rename() the directory to packs/<pack_id>-v<version>/
//     -> write the pointer record
//
// rename() within one filesystem is the atomic step: either the directory is
// there under its final name or it is not, so there is no moment at which a
// half-written pack is selectable. A staging directory left by an interrupted
// download is swept on next launch and never becomes a pack.
//
// This is the one part of the pack code that touches the file system, which is
// why it sits outside src/core (plan §2).

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { StagedFile } from '../core/pack/manifest';
import {
  assemblePack,
  packDirectoryName,
  parseManifest,
  scheduledProductsFrom,
  type PackRows,
} from '../core/pack/parse';
import { validatePack, type Violation } from '../core/pack/validators';

/** The app's own pack schema version. A pack may not require more than this. */
export const APP_PACK_SCHEMA = 3;

export const MANIFEST_NAME = 'manifest.json';
export const DATABASE_NAME = 'store.sqlite';
const POINTER_NAME = 'installed.json';
const STAGING_PREFIX = '.staging-';

export interface InstallOptions {
  /** The staging directory holding the downloaded pack. */
  stagingDir: string;
  /** The packs root, e.g. "<app support>/packs". */
  packsRoot: string;
  /** Reads every table out of the pack's database. */
  readRows: (databasePath: string) => Promise<PackRows>;
  /** ISO date the freshness check runs against. */
  asOf: string;
  freshnessWindowDays?: number;
  /** Overrides the scheduled products the pack itself declares. */
  scheduledProducts?: number[];
}

export interface InstallResult {
  installed: boolean;
  /** Absolute path of the installed pack, when it installed. */
  path?: string;
  /** Validators 1-5. Non-empty means nothing was installed. */
  blocking: Violation[];
  /** Validator 6, stored alongside the pack for the UI to read. */
  advisory: Violation[];
  /** Problems that stopped the pack being judged at all: unreadable, wrong schema. */
  errors: string[];
}

/** Every file under `dir`, as pack-relative POSIX paths. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

async function digest(path: string): Promise<StagedFile['sha256']> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/**
 * Digest everything in the staging directory except the manifest, which does
 * not declare itself.
 */
export async function stageFiles(stagingDir: string): Promise<StagedFile[]> {
  const paths = (await walk(stagingDir)).filter((p) => p !== MANIFEST_NAME);
  return Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: await digest(join(stagingDir, path)),
      bytes: (await stat(join(stagingDir, path))).size,
    })),
  );
}

export async function installPack(options: InstallOptions): Promise<InstallResult> {
  const { stagingDir, packsRoot, readRows, asOf } = options;
  const freshnessWindowDays = options.freshnessWindowDays ?? 30;
  const fail = (...errors: string[]): InstallResult => ({ installed: false, blocking: [], advisory: [], errors });

  let manifestText: string;
  try {
    manifestText = await readFile(join(stagingDir, MANIFEST_NAME), 'utf8');
  } catch {
    return fail(`${MANIFEST_NAME} is missing from the staged pack`);
  }

  const parsedManifest = parseManifest(manifestText);
  if (!parsedManifest.value) return fail(...parsedManifest.errors);
  const manifest = parsedManifest.value;

  // Refuse a pack built for a newer app before trusting anything inside it.
  if (manifest.requires.minAppSchema > APP_PACK_SCHEMA) {
    return fail(
      `this pack needs app pack schema ${manifest.requires.minAppSchema}, this app speaks ${APP_PACK_SCHEMA}`,
    );
  }

  let rows: PackRows;
  try {
    rows = await readRows(join(stagingDir, DATABASE_NAME));
  } catch (e) {
    return fail(`${DATABASE_NAME} could not be read: ${(e as Error).message}`);
  }

  const parsedPack = assemblePack(rows);
  if (!parsedPack.value) return fail(...parsedPack.errors);

  const staged = await stageFiles(stagingDir);
  const result = validatePack({
    manifest,
    staged,
    pack: parsedPack.value,
    scheduledProducts: options.scheduledProducts ?? scheduledProductsFrom(rows),
    asOf,
    freshnessWindowDays,
  });

  if (result.blocking.length > 0) {
    // Nothing half-installed: the staging directory goes, so a retry starts clean.
    await rm(stagingDir, { recursive: true, force: true });
    return { installed: false, blocking: result.blocking, advisory: result.advisory, errors: [] };
  }

  const target = join(packsRoot, packDirectoryName(manifest));
  const already = await stat(target).then(() => true, () => false);
  if (already) {
    await rm(stagingDir, { recursive: true, force: true });
    return fail(`${packDirectoryName(manifest)} is already installed; packs are immutable once published`);
  }

  await mkdir(packsRoot, { recursive: true });
  await rename(stagingDir, target);

  // Validator 6's result is stored so the UI reads it without recomputing.
  await writeFile(
    join(packsRoot, POINTER_NAME),
    `${JSON.stringify({
      current: packDirectoryName(manifest),
      packId: manifest.packId,
      packVersion: manifest.packVersion,
      layoutVersion: manifest.layoutVersion,
      installedAt: new Date().toISOString(),
      advisory: result.advisory,
    }, null, 2)}\n`,
  );

  return { installed: true, path: target, blocking: [], advisory: result.advisory, errors: [] };
}

/** Make a staging directory with a name no installed pack can collide with. */
export function stagingPath(packsRoot: string, token: string): string {
  return join(packsRoot, `${STAGING_PREFIX}${token}`);
}

/**
 * Delete staging directories left by interrupted downloads. Called on launch:
 * plan §3's "deleted on next launch and never becomes selectable".
 */
export async function sweepStaging(packsRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(packsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const swept: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX)) {
      await rm(join(packsRoot, entry.name), { recursive: true, force: true });
      swept.push(entry.name);
    }
  }
  return swept;
}
