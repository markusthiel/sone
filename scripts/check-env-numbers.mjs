#!/usr/bin/env node
/**
 * A number from the environment goes through `envNumber`, not through `Number`.
 *
 * `Number('')` is 0 and `Number('ten')` is NaN, and both typecheck as a number.
 * Where these values land — an interval string Postgres parses, a Date a column
 * has to accept, a connection pool's size — that is not a smaller number, it is
 * a statement that throws or a setting that means the opposite of what somebody
 * intended (ADR-0111).
 *
 * ADR-0104 refused to write a script for a family with **one** member, on the
 * grounds that a checker for one occurrence is ceremony and an exception list
 * with one entry is a file people edit to make the build pass. It also said
 * what would change the argument: the number.
 *
 * This family had six members, two of which were careful — one of them clamped
 * by ADR-0080, with a paragraph explaining precisely the hazard the other four
 * were exposed to. Nobody applied the paragraph to its neighbours, because
 * nothing asked. This asks.
 *
 * Narrow, like `check-rights-enforced.mjs`: it looks for the literal
 * construction in the server's source. It cannot tell a careful `Number(...)`
 * from a careless one and does not try — the point is that the careful version
 * has a name, and using it is cheaper than arguing with a checker.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pointed elsewhere only so a test can watch this fail. */
const SOURCE = process.argv[2] ?? path.join(root, 'packages', 'server', 'src');

/** The one file allowed to read a number out of the environment itself. */
const HOME = 'env.ts';

/**
 * `Number(process.env…)`, `parseInt(process.env…)`, `+process.env…`.
 *
 * Written as three patterns rather than one clever one: a regular expression
 * that matches all three and nothing else is harder to read than the thing it
 * is checking, and this file is read by somebody whose build has just failed.
 */
const PATTERNS = [
  /\bNumber\s*\(\s*process\.env\b/,
  /\bparseInt\s*\(\s*process\.env\b/,
  /\bparseFloat\s*\(\s*process\.env\b/,
  /(?<![\w)])\+\s*process\.env\b/,
];

async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

const offences = [];
let scanned = 0;

for await (const file of sources(SOURCE)) {
  scanned += 1;
  if (path.basename(file) === HOME) continue;
  const text = await readFile(file, 'utf8');
  text.split('\n').forEach((line, index) => {
    // A line that only talks about the construction — this script's own
    // description, or the comment in `env.ts` explaining what it replaces — is
    // not a use of it.
    const code = line.replace(/\/\/.*$/, '').replace(/\*.*$/, '');
    if (PATTERNS.some((pattern) => pattern.test(code))) {
      offences.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (scanned === 0) {
  console.error(`[check] no TypeScript sources under ${SOURCE}`);
  process.exit(1);
}

if (offences.length > 0) {
  console.error(
    `[check] ${offences.length} number(s) read straight from the environment:\n` +
      offences.map((one) => `  ${one}`).join('\n') +
      '\n\n' +
      'Use envNumber(key, fallback, { min, max, integer }) from src/env.ts.\n' +
      'Number("") is 0 and Number("ten") is NaN; both typecheck, and both reach\n' +
      'Postgres as a value it refuses or a setting that means the opposite of\n' +
      'what was intended (ADR-0111).',
  );
  process.exit(1);
}

console.log(`[check] ${scanned} server source(s), every environment number bounded — ok`);
