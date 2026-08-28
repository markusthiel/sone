#!/usr/bin/env node
/**
 * SONE — check that a build's version always sorts forwards.
 *
 * The version fence refuses to start when a database was last used by a newer
 * build. That is right, and it means a version scheme that ever sorts backwards
 * stops a running instance with a blank page.
 *
 * It has done so twice. Both times the logic lived in a shell fragment that ran
 * only in CI, only on a release — so it was wrong in production before it was
 * wrong anywhere else. This checks the rule instead.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { compareVersions } from '../packages/server/src/db/version.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'version.sh',
);

/**
 * Run the real script.
 *
 * Not a JavaScript reimplementation of the same rule. The shipped logic lives
 * in shell, because the image workflow has git and a POSIX shell and no
 * guaranteed node — and a test that checks a second copy of a rule only proves
 * the two copies agree.
 */
function versionFromDescribe(described: string): { version: string } {
  return { version: execFileSync('sh', [script, described], { encoding: 'utf8' }).trim() };
}

/**
 * The comparator the version fence actually uses.
 *
 * Not a local reimplementation. The previous version of this file carried its
 * own — correct — implementation of semver precedence, and checked the version
 * *scheme* against it. The fence's own comparator was wrong in a way this never
 * saw: it compared the whole pre-release as one string, so `dev.10` sorted below
 * `dev.9` and the tenth build after a tag was refused as a downgrade.
 *
 * Two implementations of one rule, and the check was watching the wrong one. So
 * this now imports the real thing, and what is checked is what ships.
 */
function compare(left: string, right: string): number {
  return compareVersions(left, right);
}

const failures: string[] = [];


/** Every build of main must sort above the tag it follows. */
const cases: Array<{
  describe: string;
  above?: string[];
  below?: string[];
  equals?: string;
}> = [
  // The one that stopped a running instance: a commit after a stable release.
  { describe: 'v0.1.0-1-gd5e039d', above: ['0.1.0', '0.1.0-rc.1-48-g99fefaf'] },
  { describe: 'v0.1.0-48-gabc1234', above: ['0.1.0'], below: ['0.1.1'] },
  // The one that stopped it the time before: after a release candidate.
  { describe: 'v0.1.0-rc.1-7-g8ff137f', above: ['0.1.0-rc.1'], below: ['0.1.0'] },
  // Exactly on a tag is that tag.
  { describe: 'v0.1.0-0-gd5e039d', equals: '0.1.0' },
  { describe: 'v0.2.0-0-gabc', equals: '0.2.0' },
  // A later patch line.
  { describe: 'v1.4.9-3-gabc', above: ['1.4.9'], below: ['1.5.0'] },

  // Two-digit commit counts, which is where the fence's own comparator was
  // wrong: it compared the whole pre-release as one string, so "dev.10" sorted
  // below "dev.9" and the tenth build after a tag stopped a running instance.
  // Every case above happens to have a single digit, which is why nothing here
  // noticed.
  {
    describe: 'v0.1.0-10-g0d11a0a',
    above: ['0.1.0', '0.1.1-dev.9.g23c9271'],
    below: ['0.1.1'],
  },
  {
    describe: 'v0.1.0-100-gabc',
    above: ['0.1.1-dev.99.gabc', '0.1.1-dev.9.gabc'],
  },
  {
    describe: 'v0.1.0-rc.1-12-gabc',
    above: ['0.1.0-rc.1.9.gabc'],
    below: ['0.1.0'],
  },
];

for (const testCase of cases) {
  const { version } = versionFromDescribe(testCase.describe);

  if (testCase.equals !== undefined && version !== testCase.equals) {
    failures.push(`${testCase.describe} produced ${version}, expected ${testCase.equals}`);
  }

  for (const lower of testCase.above ?? []) {
    if (compare(version, lower) <= 0) {
      failures.push(
        `${testCase.describe} produced ${version}, which does not sort above ${lower} — ` +
          'an instance on that version would refuse to start',
      );
    }
  }

  for (const higher of testCase.below ?? []) {
    if (compare(version, higher) >= 0) {
      failures.push(`${version} should sort below ${higher}`);
    }
  }
}

// A repository with no tags must still produce something parseable rather than
// a bare commit hash, which is not a version and cannot be compared at all.
const untagged = versionFromDescribe('abc1234').version;
if (!/^\d+\.\d+\.\d+/.test(untagged)) {
  failures.push(`an untagged repository produced ${untagged}, which is not a version`);
}

// The comparison used above has to be right, or the checks are decorative.
assert.equal(compare('0.1.0', '0.1.0'), 0);
assert.equal(compare('0.1.0-rc.1', '0.1.0'), -1, 'a pre-release is below its release');
assert.equal(compare('0.1.1-dev.1.gabc', '0.1.0'), 1);
assert.equal(compare('0.1.0-1-gabc'.replace('-1-g', '-1.g'), '0.1.0'), -1);

if (failures.length > 0) {
  console.error('[check] build versions do not sort forwards:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`[check] build version ordering — ${cases.length} case(s) ok`);
