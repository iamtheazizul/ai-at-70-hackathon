// Build a pack the dev server can serve, so the app runs on a real pack rather
// than the bundled fixture:
//
//   npm run build-pack
//
// Emits public/pack/, which Vite serves at /pack. It is a built artefact, not
// source, so it is gitignored — a fresh clone falls back to the fixture until
// this is run, and the app says which it is using.
//
// --no-photos because the fixture's photo files do not exist in the repo. The
// builder drops the photo paths rather than claiming files it has not got, so
// the pack stays internally honest.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'public/pack';
const work = mkdtempSync(join(tmpdir(), 'shoptimal-webpack-'));

try {
  const rows = join(work, 'rows.json');

  const exported = spawnSync('node', ['scripts/export-rows.mjs', rows], { stdio: 'inherit' });
  if (exported.status !== 0) process.exit(exported.status ?? 1);

  const built = spawnSync(
    'python3',
    ['tools/packbuild/build.py', rows, OUT, '--json', '--no-photos', '--force'],
    { stdio: 'inherit' },
  );
  if (built.error?.code === 'ENOENT') {
    console.error('python3 not found; it is needed to build a pack');
    process.exit(1);
  }
  if (built.status !== 0) process.exit(built.status ?? 1);

  console.log(`\nServed at /pack once the dev server restarts. npm run dev`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
