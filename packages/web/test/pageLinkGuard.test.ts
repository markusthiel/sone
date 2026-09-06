/**
 * The guard that keeps a link from dropping its credential (ADR-0113).
 *
 * `scripts/check-page-links.mjs` fails the build when a component builds a page
 * URL with `paths.page()` instead of asking `usePageLink()`. It matters because
 * a component cannot tell whether it is rendering into the workspace shell or
 * into somebody's share link, and the wrong answer is a login screen one click
 * into a document they were given.
 *
 * The first test is the one worth having: a guard nobody has seen catch
 * anything is a guard nobody should believe.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../../../scripts/check-page-links.mjs', import.meta.url));

const run = (source?: string): { code: number; err: string } => {
  const result = spawnSync(process.execPath, source ? [script, source] : [script], {
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, err: `${result.stderr}${result.stdout}` };
};

/** A tree with one component file at the given relative path. */
function tree(relative: string, source: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-links-'));
  const full = path.join(dir, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, source);
  return dir;
}

test('it fails on a component that builds a member URL', () => {
  const dir = tree(
    'components/FolderView.tsx',
    `const href = paths.page(child.id, child.title);\n`,
  );
  try {
    const { code, err } = run(dir);
    assert.equal(code, 1, 'the build stops');
    assert.match(err, /components\/FolderView\.tsx:1/, 'and names the line');
    assert.match(err, /usePageLink/, 'and what to use instead');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('and leaves the module that chooses between the two alone', () => {
  // `routes/` is where both shapes are named, so it is the one place the call
  // has to appear. A guard that failed there could not be satisfied.
  const dir = tree('routes/pageLink.tsx', `export const x = () => paths.page('a');\n`);
  try {
    assert.equal(run(dir).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a call named in a comment is not a call', () => {
  // The cost of reading whole files: this repository explains itself, and
  // several of these components carry a paragraph about why the call is gone.
  const dir = tree(
    'components/Thing.tsx',
    [
      '/**',
      ' * This used to call paths.page() and that was the bug.',
      ' */',
      "// paths.page(id) — no longer, see ADR-0113",
      'export const x = 1;',
      '',
    ].join('\n'),
  );
  try {
    assert.equal(run(dir).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty tree is refused rather than passed', () => {
  // Zero files scanned is trivially "no offences", which is how a guard becomes
  // decoration when its path goes stale.
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-links-'));
  try {
    assert.equal(run(dir).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('and it passes on the source this repository actually has', () => {
  const { code, err } = run();
  assert.equal(code, 0, err);
});
