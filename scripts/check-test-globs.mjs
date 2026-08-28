#!/usr/bin/env node
/**
 * SONE — check that every test file is actually run.
 *
 * A test that nothing runs is worse than no test: it reports nothing, and its
 * presence says the case is covered.
 *
 * This exists because it happened. `packages/web` had its test script written
 * as `test/*.test.ts`, and the React tests are `.tsx` — so the harness that
 * mounts components, and the drag tests written specifically because the
 * behaviour had been wrong three times, never ran in CI at all. They passed
 * when invoked by hand, which is exactly why nobody noticed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = readdirSync(path.join(root, 'packages'));

const problems = [];

for (const name of packages) {
  const dir = path.join(root, 'packages', name);
  const testDir = path.join(dir, 'test');

  let files;
  try {
    files = readdirSync(testDir, { recursive: true });
  } catch {
    continue;
  }

  const script = JSON.parse(
    readFileSync(path.join(dir, 'package.json'), 'utf8'),
  ).scripts?.test;
  if (!script) {
    problems.push(`${name}: has a test directory and no test script`);
    continue;
  }

  // Which extensions the script's globs would pick up. Checked rather than
  // parsed properly: a glob that mentions an extension will match it, and one
  // that never mentions it cannot.
  const extensions = new Set();
  for (const file of files) {
    const asString = String(file);
    if (!/\.test\.[jt]sx?$/.test(asString)) continue;
    extensions.add(path.extname(asString));
  }

  for (const extension of extensions) {
    if (!script.includes(`.test${extension}`)) {
      const examples = files
        .map(String)
        .filter((file) => file.endsWith(`.test${extension}`))
        .slice(0, 3);
      problems.push(
        `${name}: test script does not run *.test${extension} files ` +
          `(${examples.join(', ')}) — script is: ${script}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error('[check] test files that nothing runs:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('[check] every test file is matched by its package test script — ok');
