/**
 * The export carries no comments — and a tripwire for the day it does.
 *
 * ADR-0057 said "the internal document is exported with the page for a member,
 * and not at all for anything with a share token". Checking that turned out to
 * be checking a premise that is false: **the export contains no comments at
 * all**, neither the page's own nor the internal ones. There was nothing to
 * exclude.
 *
 * Which matters more than it sounds, because a share-link visitor *can* export:
 * the route requires `canRead`, which a share token grants for the page it was
 * made for. So the moment somebody adds comments to an export — a reasonable
 * thing to want — an anonymous visitor would receive the internal discussion in
 * a file, and no test would have said a word.
 *
 * This is that word. It fails when the export starts reading comments, and
 * whoever makes it fail has to decide about the two audiences deliberately
 * rather than discover the decision later.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

function sources(dir: URL): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) out.push(...sources(child));
    else if (entry.name.endsWith('.ts')) {
      out.push({ name: entry.name, text: readFileSync(child, 'utf8') });
    }
  }
  return out;
}

test('nothing in the export path reads a comment table', () => {
  const files = sources(new URL('../src/export/', import.meta.url));
  assert.ok(files.length >= 3, 'the export sources were found');

  const offenders: string[] = [];
  for (const file of files) {
    // The two projected tables, and the document key a thread lives under.
    for (const forbidden of ['page_comments', 'page_comments_internal', 'commentThreads']) {
      if (file.text.includes(forbidden)) offenders.push(`${file.name}: ${forbidden}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'the export reads comments now — decide what a share-link visitor gets (ADR-0057)',
  );
});

test('the export is reachable by a share-link visitor, which is why the above matters', () => {
  // Not a hypothetical audience: `canRead` is what the route requires, and a
  // share token grants it for the page the link was made for. If this ever
  // becomes "members only", the test above is less urgent — and this assertion
  // is where somebody would notice that it had changed.
  const routes = readFileSync(new URL('../src/export/routes.ts', import.meta.url), 'utf8');
  assert.match(routes, /!canRead\(claims, location\)/);
  assert.match(routes, /claims\.principal\.kind === 'anonymous' \? null :/);
});
