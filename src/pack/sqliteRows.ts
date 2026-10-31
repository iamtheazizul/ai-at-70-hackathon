// Read a pack's tables out of store.sqlite.
//
// node:sqlite is built in from Node 22 and needs no dependency, which is why it
// is used here rather than a native module. It is still flagged experimental.
// On the native targets the plan recommends (§1), SQLite is first-class and
// this file is replaced by the platform's own reader.
//
// The pack is opened read-only. Nothing ever writes to store.sqlite.
//
// Why createRequire and not `await import('node:sqlite')`: Vite's transform
// rewrites a dynamic import of a node: builtin to a bare specifier and then
// fails to resolve it, including when the specifier is held in a variable and
// marked @vite-ignore. The first version of this file hit that and the
// end-to-end test quietly skipped itself, looking exactly like a runtime
// without SQLite. createRequire is a function call, so no bundler rewrites it,
// and it behaves the same under vitest and plain Node.

import { createRequire } from 'node:module';
import type { PackRows } from '../core/pack/parse';

const requireBuiltin = createRequire(import.meta.url);

const TABLES = [
  'store', 'node', 'edge', 'aisle', 'aisle_sign_variant', 'section',
  'product', 'product_barcode', 'product_location', 'node_distance',
  'scheduled_product',
] as const;

function loadSqlite(): typeof import('node:sqlite') {
  return requireBuiltin('node:sqlite');
}

/** Whether this runtime can read store.sqlite at all. */
export function sqliteAvailable(): boolean {
  try {
    loadSqlite();
    return true;
  } catch {
    return false;
  }
}

export async function readRowsFromSqlite(databasePath: string): Promise<PackRows> {
  let sqlite: typeof import('node:sqlite');
  try {
    sqlite = loadSqlite();
  } catch {
    throw new Error('node:sqlite is unavailable; Node 22 or newer is required to read store.sqlite');
  }

  const db = new sqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = {} as PackRows;
    for (const table of TABLES) {
      // scheduled_product is written by tools/packbuild; tolerate its absence
      // in a pack built before it existed.
      try {
        rows[table] = db.prepare(`select * from ${table}`).all() as Record<string, unknown>[];
      } catch (e) {
        if (table === 'scheduled_product') rows[table] = [];
        else throw e;
      }
    }
    return rows;
  } finally {
    db.close();
  }
}
