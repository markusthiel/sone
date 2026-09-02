/**
 * What an import would do (ADR-0044).
 *
 * The plan is the feature: an import that has created two hundred pages by the
 * time somebody notices it mangled the hierarchy is worse than no import. So
 * these tests are about the description being right — including the parts that
 * say what will *not* happen.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { zip } from '../src/export/zip.js';
import { unzip } from '../src/import/unzip.js';
import { MAX_DEPTH, bodyWithoutTitle, planImport, titleFrom } from '../src/import/plan.js';

const at = new Date('2026-09-02T10:30:00Z');
const nothing = { byPath: new Map<string, string>() };

const archive = (files: Array<[string, string]>) =>
  unzip(zip(files.map(([name, body]) => ({ name, body: Buffer.from(body), at }))));

test('a folder’s index is the folder, not a page inside it', () => {
  // Which is what our own export writes, so this is half of the round trip.
  const plan = planImport(
    archive([
      ['Buchhaltung/index.md', '# Buchhaltung\n'],
      ['Buchhaltung/Übersicht.md', '# Übersicht\n\nInhalt.\n'],
    ]),
    nothing,
  );

  assert.deepEqual(
    plan.pages.map((page) => [page.path.join('/'), page.isFolder, page.title]),
    [
      ['Buchhaltung', true, 'Buchhaltung'],
      ['Buchhaltung/Übersicht', false, 'Übersicht'],
    ],
  );
  assert.deepEqual(plan.totals, { pages: 1, folders: 1, attachments: 0, bytes: 0 });
});

test('a folder with no index of its own is still created', () => {
  // A page at `A/B/C.md` needs A and B to exist, and an archive from somewhere
  // else will not have written them.
  const plan = planImport(archive([['A/B/C.md', '# C\n']]), nothing);
  assert.deepEqual(
    plan.pages.map((page) => [page.path.join('/'), page.isFolder]),
    [
      ['A', true],
      ['A/B', true],
      ['A/B/C', false],
    ],
    'shallowest first, so a parent exists before what needs it',
  );
});

test('a collision is named, not resolved', () => {
  // The plan says what would happen; deciding is somebody else's job, and doing
  // it silently is the thing this whole design refuses.
  const existing = { byPath: new Map([['buchhaltung/übersicht', 'page-1']]) };
  const plan = planImport(
    archive([['Buchhaltung/Übersicht.md', '# Übersicht\n']]),
    existing,
  );
  const page = plan.pages.find((one) => !one.isFolder);
  assert.equal(page?.collidesWith, 'page-1');
  // Case-insensitively, because two pages whose titles differ only in case are
  // the same page to somebody looking at a sidebar.
  const other = planImport(archive([['BUCHHALTUNG/ÜBERSICHT.md', '# X\n']]), existing);
  assert.equal(other.pages.find((one) => !one.isFolder)?.collidesWith, 'page-1');
});

test('what is not being imported is listed, with a reason', () => {
  // An archive from elsewhere carries a stylesheet and a picture of a cat.
  // Telling somebody what will not come is more use than refusing the lot.
  const plan = planImport(
    archive([
      ['Notes/Page.md', '# Page\n'],
      ['Notes/style.css', 'body{}'],
      ['index.md', '# The destination itself\n'],
    ]),
    nothing,
  );
  assert.deepEqual(plan.skipped, [
    { name: 'Notes/style.css', reason: 'not_markdown' },
    { name: 'index.md', reason: 'empty' },
  ]);
});

test('attachments are counted but not confused with pages', () => {
  const plan = planImport(
    archive([
      ['Page.md', '# Page\n\n![A plan](attachments/f-1)\n'],
      ['attachments/f-1', 'bytes'],
    ]),
    nothing,
  );
  assert.deepEqual(plan.attachments, [{ name: 'f-1', bytes: 5 }]);
  assert.equal(plan.totals.pages, 1);
});

test('a tree deeper than the limit is refused per file, not per archive', () => {
  const deep = Array.from({ length: MAX_DEPTH + 2 }, (_, i) => `d${i}`).join('/');
  const plan = planImport(archive([[`${deep}/Page.md`, '# Page\n'], ['Fine.md', '# Fine\n']]), nothing);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.totals.pages, 1, 'the rest still arrives');
});

test('the title comes from the heading, and the heading leaves the body', () => {
  // A file called `2026-09-02.md` whose heading says "Kick-off" should arrive as
  // "Kick-off" — the date is in the file name for sorting. And a page whose own
  // name is written twice, once as the title and once as a heading under it, is
  // what leaving the heading in produces.
  assert.equal(titleFrom('# Kick-off\n\nWords.\n', '2026-09-02'), 'Kick-off');
  assert.equal(titleFrom('No heading here.\n', '2026-09-02'), '2026-09-02');
  assert.equal(bodyWithoutTitle('# Kick-off\n\nWords.\n'), 'Words.\n');
});
