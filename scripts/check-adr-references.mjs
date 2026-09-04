#!/usr/bin/env node
/**
 * Every ADR a comment cites exists.
 *
 * Written because I twice cited a record that did not exist, in code and in a
 * test, with a number that was wrong as well — the next free one was 0066.
 *
 * The offending number is not written out here, and that is not squeamishness:
 * this check caught its own explanation on the first run, because a sentence
 * *about* a citation is a citation as far as a reader searching the tree is
 * concerned. Which is the right answer — somebody grepping for a record should
 * not find a file claiming to discuss it.
 *
 * A citation is a promise that somebody can go and read the
 * reasoning, and a dangling one is worse than no citation at all: it sends a
 * reader looking for a file, and when they do not find it they stop trusting
 * the other four hundred citations too.
 *
 * Reads files rather than running anything, and proves it can fail first.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const existing = new Set(
  readdirSync('docs/adr')
    .map((name) => /^(\d{4})-/.exec(name)?.[1])
    .filter((one) => one !== undefined),
);

/** Where citations live: source, tests, and the records themselves. */
const ROOTS = ['packages', 'docs', 'scripts', 'db'];
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

const dangling = [];
let cited = 0;

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(ts|tsx|md|sql|mjs|css)$/.test(entry)) continue;

    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/ADR-(\d{4})/g)) {
      cited += 1;
      const number = match[1];
      if (!existing.has(number)) dangling.push(`${path}: ADR-${number}`);
    }
  }
};

for (const root of ROOTS) walk(root);

// Prove the reader works before trusting that it found nothing.
if (cited < 100 || existing.size < 50) {
  console.error(
    `[check] found ${cited} citations across ${existing.size} records — the reader is broken`,
  );
  process.exit(1);
}

if (dangling.length > 0) {
  console.error('[check] citations pointing at records that do not exist:');
  for (const one of [...new Set(dangling)]) console.error(`  ${one}`);
  console.error(
    '\nA citation is a promise that somebody can go and read the reasoning.\n' +
      'Write the record, or cite the one that exists.',
  );
  process.exit(1);
}

console.log(`[check] ${cited} ADR citations, all pointing at records — ok`);
