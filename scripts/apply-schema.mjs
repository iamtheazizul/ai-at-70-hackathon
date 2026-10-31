// Apply every file in supabase/migrations, in name order, to the project's
// Postgres.
//
// Why not the Management API: /v1/projects/{ref}/database/query authenticates
// with a personal access token (sbp_...), not with a project secret key. The
// earlier version of this script sent SUPABASE_SECRET_KEY there and got back
// 401 "JWT could not be decoded" every time, which is why no schema has ever
// been applied to this project.
//
// Why not psql "$SUPABASE_DB_URL": argv is world-readable in `ps`, and that URL
// carries the database password. The URL is split into PG* environment
// variables instead, so the password is never an argument.
//
// supabase/schema.sql is deliberately NOT applied here. It models the same
// things as 0001_mvp.sql under different table names; see the banner at its top.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

function loadEnv() {
  const values = {};
  try {
    for (const line of readFileSync(new URL('.env', root), 'utf8').split('\n')) {
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

const env = loadEnv();
const raw = process.env.SUPABASE_DB_URL ?? env.SUPABASE_DB_URL ?? '';

if (!raw) {
  console.error(
    [
      'SUPABASE_DB_URL is not set.',
      '',
      'Supabase dashboard -> Project Settings -> Database -> Connection string',
      '-> URI. Copy the one labelled Session pooler and put it in .env as',
      '',
      '  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres',
      '',
      '.env is gitignored. Do not commit this value: it is a database password,',
      'not a publishable key.',
    ].join('\n'),
  );
  process.exit(1);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.error('SUPABASE_DB_URL is not a valid URL. Expected postgresql://user:password@host:port/database');
  process.exit(1);
}

const migrations = readdirSync(new URL('supabase/migrations/', root))
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (migrations.length === 0) {
  console.error('No .sql files in supabase/migrations.');
  process.exit(1);
}

// Password goes through the environment, never argv.
const pgEnv = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
  PGSSLMODE: process.env.PGSSLMODE ?? 'require',
};

console.log(`Applying ${migrations.length} migration(s) to ${url.hostname}/${pgEnv.PGDATABASE} as ${pgEnv.PGUSER}`);

for (const name of migrations) {
  const file = fileURLToPath(new URL(`supabase/migrations/${name}`, root));
  console.log(`\n-- ${name}`);
  // ON_ERROR_STOP and a single transaction: a migration either lands whole or
  // not at all, so a failure halfway cannot leave a half-built schema.
  const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', file], {
    env: pgEnv,
    stdio: 'inherit',
  });
  if (result.error?.code === 'ENOENT') {
    console.error('\npsql not found on PATH. brew install postgresql@15');
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${name} failed. Nothing from that file was applied.`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nDone. Verify with: npm run check-schema');
