// Ask PostgREST whether the tables the app reads are actually there.
//
// This is the check that was missing: loadRemoteCatalog() swallows every error
// and falls back to the bundled demo catalogue, so a completely unapplied
// schema looks exactly like a working app. Run this to tell the two apart.
//
// Needs only the publishable key, which is already in .env and is safe to ship
// to a browser: the tables are select-only to anon under RLS.

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

// Exactly what src/mvp/remote.ts asks for, so a pass here means the app works.
const PROBES = [
  ['stores', 'id,name,note'],
  ['products', 'id,name'],
  ['synonyms', 'product_id,phrase'],
  ['locations', 'store_id,product_id,aisle'],
  ['substitute_rules', 'store_id,product_id,substitute_product_id'],
  ['lists', 'id,store_id,title'],
  ['list_items', 'list_id,position,raw_text'],
  ['trips', 'id,store_id,shopper'],
  ['trip_items', 'trip_id,product_id,status'],
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
    console.log(`  ok       ${table.padEnd(18)} ${total} row(s)`);
    continue;
  }

  missing += 1;
  const body = await response.json().catch(() => ({}));
  const reason = body.code === 'PGRST205' ? 'table not in the schema cache' : (body.message ?? response.statusText);
  console.log(`  MISSING  ${table.padEnd(18)} ${response.status} ${reason}`);
}

if (missing > 0) {
  console.error(`\n${missing} of ${PROBES.length} tables unreachable. The app is on bundled demo data.`);
  console.error('Apply the migrations with: npm run apply-schema');
  process.exit(1);
}

console.log(`\nAll ${PROBES.length} tables reachable. The app will read live data.`);
