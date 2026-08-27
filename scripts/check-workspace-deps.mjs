#!/usr/bin/env node
/**
 * Verify every workspace dependency is built before it is typechecked.
 *
 * Packages resolve each other through their built declarations
 * (`dist/index.d.ts`), so a `typecheck` script must run `tsc -b` on each of its
 * workspace dependencies first. Miss one and the command passes on a machine
 * that has built before and fails on a clean checkout — which is a confusing
 * first-day experience and a red CI run for a reason that names a missing
 * module rather than a missing build step.
 *
 * This has now happened twice: once when the workspace was set up, and again
 * when @sone/editor was added as a dependency of @sone/web without being added
 * to its build list. Twice is enough to check it mechanically.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(root, 'packages');

const entries = await readdir(packagesDir, { withFileTypes: true });
const problems = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const manifestPath = path.join(packagesDir, entry.name, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    continue;
  }

  const workspaceDeps = Object.entries({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  })
    .filter(([, version]) => String(version).startsWith('workspace:'))
    .map(([name]) => name);

  if (workspaceDeps.length === 0) continue;

  for (const script of ['typecheck', 'test']) {
    const command = manifest.scripts?.[script];
    if (!command) continue;

    const missing = workspaceDeps.filter((dep) => {
      // @sone/core -> ../core
      const dir = dep.replace(/^@sone\//, '');
      return !command.includes(`../${dir}`);
    });

    if (missing.length > 0) {
      problems.push({
        pkg: manifest.name,
        script,
        missing,
        command,
      });
    }
  }
}

if (problems.length === 0) {
  console.log('[check] workspace dependencies are built before typecheck — ok');
  process.exit(0);
}

console.error('[check] a script does not build all of its workspace dependencies:\n');
for (const problem of problems) {
  console.error(`  ${problem.pkg} → ${problem.script}`);
  console.error(`    missing: ${problem.missing.join(', ')}`);
  console.error(`    current: ${problem.command}\n`);
}
console.error(`Add each to the tsc -b list, e.g.:
  "typecheck": "tsc -b ../core ../editor && tsc -p tsconfig.json --noEmit"

Without it the command passes where a build has already run and fails on a
clean checkout, reporting a missing module rather than a missing build step.
`);
process.exit(1);
