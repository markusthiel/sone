#!/usr/bin/env node
/**
 * Fail if more than one copy of the CRDT libraries is installed.
 *
 * Two copies of Yjs in one process is not a versioning nicety, it is a
 * correctness failure: `instanceof` comparisons fail across copies, so a
 * Y.Doc created by one copy is unrecognisable to code holding the other. The
 * symptom is a document that silently refuses to sync, or an editor that shows
 * nothing while the data is fine — both of which look like application bugs and
 * are neither.
 *
 * This happened once already: pinning yjs exactly in @sone/editor while every
 * other package used a caret range produced 13.6.20 and 13.6.32 side by side.
 * The type checker caught it that time, with an error message thirty lines long
 * that named neither the cause nor the fix. This check names both.
 *
 * Run by CI and by `pnpm check`.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SINGLETON_PACKAGES = ['yjs', 'y-protocols', 'lib0', 'prosemirror-model', 'prosemirror-state'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = path.join(root, 'node_modules', '.pnpm');

let entries;
try {
  entries = await readdir(store);
} catch {
  console.error(`[check] ${store} not found — run pnpm install first.`);
  process.exit(1);
}

const problems = [];

for (const name of SINGLETON_PACKAGES) {
  // pnpm's store encodes a package as `name@version` with peer suffixes after
  // an underscore, so the version is what sits between the last '@' and the
  // first '_'.
  const prefix = `${name}@`;
  const versions = new Set(
    entries
      .filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes('@'))
      .map((entry) => entry.slice(prefix.length).split('_')[0]),
  );

  if (versions.size > 1) {
    problems.push({ name, versions: [...versions].sort() });
  }
}

if (problems.length === 0) {
  console.log(`[check] single copy of ${SINGLETON_PACKAGES.join(', ')} — ok`);
  process.exit(0);
}

console.error('[check] multiple copies of a package that must be a singleton:\n');
for (const problem of problems) {
  console.error(`  ${problem.name}: ${problem.versions.join(', ')}`);
}
console.error(`
Two copies in one process break instanceof, so objects created by one are
unrecognisable to the other. For Yjs that means documents that will not sync.

Fix: align the version in every packages/*/package.json, and add an entry to
pnpm.overrides in the root package.json so a transitive dependency cannot
reintroduce a second copy. Then delete pnpm-lock.yaml and reinstall — an
existing lockfile keeps the old resolution.
`);
process.exit(1);
