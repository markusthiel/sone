/**
 * The helper that lets assertions about code read code.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { codeOf, stylesOf } from './source.ts';

const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('comments are removed, code is not', () => {
  const stripped = codeOf(new URL('./fixture.tsx', import.meta.url));
  assert.doesNotMatch(stripped, /never happens/, 'line comment');
  assert.doesNotMatch(stripped, /nor this/, 'block comment');
  assert.doesNotMatch(stripped, /nor in JSX/, 'JSX comment body');
  // The braces it sat in are left. Harmless to match against, and removing them
  // deleted empty object literals from real code when it was tried.
  assert.match(stripped, /const keep = 'pointerdown'/, 'code survives');
});

test('a stylesheet keeps its rules and loses its comments', () => {
  const stripped = stylesOf(new URL('./fixture.css', import.meta.url));
  assert.doesNotMatch(stripped, /explanation/);
  assert.match(stripped, /\.kept \{ color: red; \}/);
});

test('no test asserts absence against a raw file', () => {
  // The mistake this exists for: three tests matched the comment explaining why
  // something is absent, and the obvious repair — rewording the comment —
  // silences the test without touching the code.
  //
  // So a test may only assert absence against text that went through the
  // helper. Checked across the suite rather than trusted, because the pattern
  // is easy to reintroduce and reads as correct.
  const offenders: string[] = [];

  for (const name of readdirSync(testDir)) {
    if (!name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) continue;
    const source = readFileSync(path.join(testDir, name), 'utf8');

    // Only files that do both: read a file from src, and assert something is
    // absent. A first version flagged any file with a doesNotMatch in it, and
    // caught five that assert absence in runtime strings or URLs — a check with
    // false positives teaches people to ignore its output, which is the same
    // mistake as the one it exists to prevent.
    const readsSource = /readFileSync\([^)]*['"`][^'"`]*\.\.\/src\//s.test(source);
    if (!readsSource || !/doesNotMatch\(/.test(source)) continue;
    if (!/codeOf\(|stylesOf\(/.test(source)) offenders.push(name);
  }

  assert.deepEqual(offenders, [], `reading raw files: ${offenders.join(', ')}`);
});
