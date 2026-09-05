/**
 * The guard that keeps a right from being a lie (ADR-0087).
 *
 * `scripts/check-rights-enforced.mjs` fails the build when a name in the
 * `RIGHTS` enumeration is not consulted by any server-side check. That matters
 * because a role's rights are edited in a settings screen: a switch there that
 * gates nothing is worse than a missing feature, since somebody turns it off,
 * believes they have taken something away, and has not.
 *
 * The first test is the one worth having. A guard nobody has seen catch
 * anything is a guard nobody should believe, and this project has shipped two
 * of those — a check nobody read (ADR-0077) and a status that lied (ADR-0084).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../../../scripts/check-rights-enforced.mjs', import.meta.url));

const run = (declaration?: string): { code: number; err: string } => {
  const result = spawnSync(process.execPath, declaration ? [script, declaration] : [script], {
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, err: `${result.stderr}${result.stdout}` };
};

test('it fails on a right that nothing consults', () => {
  // A name invented here and wired to nothing, which is exactly the mistake:
  // adding the switch before the check behind it.
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-rights-'));
  const fake = path.join(dir, 'access.ts');
  writeFileSync(
    fake,
    `export const RIGHTS = ['people.manage', 'nobody.checks.this'] as const;\n`,
  );

  try {
    const { code, err } = run(fake);
    assert.equal(code, 1, 'the build stops');
    assert.match(err, /nobody\.checks\.this/, 'and names the right it could not find');
    assert.match(err, /a right nobody checks is a lie/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('and it passes on the enumeration this repository actually has', () => {
  // The other half. A guard that fails on everything is as useless as one that
  // fails on nothing, and this is what proves the failure above was about the
  // invented name rather than about the checker being broken.
  const { code, err } = run();
  assert.equal(code, 0, err);
});

test('an empty enumeration is refused rather than passed', () => {
  /*
   * Zero rights is trivially "every right is consulted", so a checker written
   * the obvious way reports success on an enumeration somebody has emptied by
   * accident — or on a file whose format changed under the regular expression.
   * Silence there would mean nothing at all.
   */
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-rights-'));
  const fake = path.join(dir, 'access.ts');
  writeFileSync(fake, `export const RIGHTS = [] as const;\n`);

  try {
    const { code } = run(fake);
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
