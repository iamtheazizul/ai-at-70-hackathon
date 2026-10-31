// Load src/data/sampleStore.ts from a Node script.
//
// The fixture is TypeScript and its only import is `import type`, so compiling
// it alone produces a standalone module. Shared by gen-seed and export-rows so
// the compile incantation lives in one place.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @returns {Promise<{pack: any, list: any, dispose: () => void}>} */
export async function loadFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'shoptimal-fixture-'));
  const tsc = spawnSync(
    'npx',
    ['tsc', 'src/data/sampleStore.ts', '--outDir', tmp, '--rootDir', 'src',
     '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck'],
    { stdio: 'inherit' },
  );
  if (tsc.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error('tsc failed on src/data/sampleStore.ts');
  }
  const mod = await import(pathToFileURL(join(tmp, 'data/sampleStore.js')).href);
  return {
    pack: mod.sampleStorePack,
    list: mod.sampleList,
    dispose: () => rmSync(tmp, { recursive: true, force: true }),
  };
}
