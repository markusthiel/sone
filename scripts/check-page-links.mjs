#!/usr/bin/env node
/**
 * A link to a page is built by the helper that knows how this person got here.
 *
 * There are two shapes — `/p/<id>/<slug>` for a member with a session, and
 * `/s/<token>/p/<id>/<slug>` for somebody holding a share link — and a
 * component cannot tell which it is rendering into. `usePageLink()` reads the
 * token from context and answers; `paths.page()` always answers the first, and
 * every component called it (ADR-0113).
 *
 * That was one login wall in a shared folder's listing, and five more waiting:
 * a collection table, a gallery, a board, a relation chip and the editor's own
 * container link are all page **body** content, so all of them render inside a
 * shared page.
 *
 * `paths.ts` had stated the rule in its own header since ADR-0016 — "a share
 * link keeps its prefix while navigating its subtree" — and nothing enforced
 * it. `paths.sharePage`, the one correct builder, had no callers at all.
 *
 * ADR-0104 refused a checker for a family with one member and named what would
 * change the argument: the number. Nineteen call sites, ten of them reachable
 * from a share view.
 *
 * No exception list, and that is the point. The helper answers the same as
 * `paths.page` when there is no token, so a screen that can only ever be a
 * member's loses nothing by asking — and an exception list is where the next
 * component that "obviously" cannot be shared would be written down, by
 * somebody who is about to be wrong about that.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pointed elsewhere only so a test can watch this fail. */
const SOURCE = process.argv[2] ?? path.join(root, 'packages', 'web', 'src');

/** Where the two shapes are allowed to be named: the module that chooses. */
const HOME = ['routes'];

const CALL = /\bpaths\s*\.\s*page\s*\(/;

async function* sources(dir, trail = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full, [...trail, entry.name]);
    else if (/\.tsx?$/.test(entry.name)) yield { full, trail };
  }
}

const offences = [];
let scanned = 0;

for await (const { full, trail } of sources(SOURCE)) {
  scanned += 1;
  if (trail.some((part) => HOME.includes(part))) continue;

  const text = await readFile(full, 'utf8');
  text.split('\n').forEach((line, index) => {
    // A line that only talks about the call is not a call. Prose in this
    // repository is `//`, `*` continuation lines, or a backticked name inside
    // one — the same line drawn by `check-env-numbers.mjs`.
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*[*]/.test(line) || /^\s*\/\*/.test(line)) return;
    if (CALL.test(code)) {
      offences.push(`${path.relative(root, full)}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (scanned === 0) {
  console.error(`[check] no TypeScript sources under ${SOURCE}`);
  process.exit(1);
}

if (offences.length > 0) {
  console.error(
    `[check] ${offences.length} page link(s) built without asking how this person got here:\n` +
      offences.map((one) => `  ${one}`).join('\n') +
      '\n\n' +
      'Use usePageLink() from src/routes/pageLink.tsx.\n' +
      'paths.page() always builds a member URL, and a component cannot tell\n' +
      'whether it is rendering into a share link — so the credential is dropped\n' +
      'and the click lands on the login screen (ADR-0113).',
  );
  process.exit(1);
}

console.log(`[check] ${scanned} web source(s), every page link is mode-aware — ok`);
