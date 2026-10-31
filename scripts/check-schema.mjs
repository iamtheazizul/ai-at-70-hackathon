// Ask PostgREST whether the migrations have actually been applied.
//
// Reads with the publishable key only, which is safe: under the graph schema's
// RLS, anon has no read access to master data at all.
//
// So a correctly applied schema reports every master table as present with
// ZERO rows. That is not a failure — it is the RLS working. Existence is what
// this checks: 404 means the table is not there, 200 means it is. The row count
// is only meaningful for store_pack, whose policy exposes published packs.
//
// To see the seeded rows you need a credential that bypasses RLS (psql over
// SUPABASE_DB_URL, or the dashboard table editor).

import { readFileSync } from 'node:fs';

function loadEnv() {
  const values = {};
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
  } catch {
    // No .env: fall through to the process environment.
  }
  return values;
}

const env = { ...loadEnv(), ...process.env };
const url = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? '';
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? '';

if (!url || !key) {
  console.error('Need VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.');
  process.exit(1);
}

// The eleven tables of supabase/migrations/0001_store_graph.sql.
const PROBES = [
  ['store', 'id,name,layout_version'],
  ['node', 'id,kind,label,x_metres,y_metres'],
  ['edge', 'id,a_node,b_node,metres,measured'],
  ['aisle', 'id,label,is_cold'],
  ['aisle_sign_variant', 'aisle_id,variant,kind'],
  ['section', 'id,aisle_id,side,bay'],
  ['product', 'id,name,brand,category'],
  ['product_barcode', 'barcode,product_id'],
  ['product_location', 'product_id,section_id,source,review_status'],
  ['location_observation', 'id,product_id,review_outcome'],
  ['store_pack', 'id,pack_version,published'],
];

console.log(`${url}\n`);

let missing = 0;
for (const [table, select] of PROBES) {
  const response = await fetch(`${url}/rest/v1/${table}?select=${select}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });

  if (response.ok) {
    // content-range comes back as "0-0/12"; the tail is the total row count.
    const total = (response.headers.get('content-range') ?? '').split('/')[1] ?? '?';
    const note = total === '0' && table !== 'store_pack' ? ' (0 expected: RLS hides master data from anon)' : '';
    console.log(`  ok       ${table.padEnd(22)} ${total} row(s)${note}`);
    continue;
  }

  missing += 1;
  const body = await response.json().catch(() => ({}));
  const reason = body.code === 'PGRST205' ? 'table not in the schema cache' : (body.message ?? response.statusText);
  console.log(`  MISSING  ${table.padEnd(22)} ${response.status} ${reason}`);
}

if (missing > 0) {
  console.error(`\n${missing} of ${PROBES.length} tables are not there.`);
  console.error('Apply the migrations with: npm run apply-schema');
  process.exit(1);
}

console.log(`\nAll ${PROBES.length} tables present. Master data reads as empty to anon, by design.`);
