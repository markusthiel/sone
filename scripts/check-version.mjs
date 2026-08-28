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
function versionFromDescribe(described) {
  return { version: execFileSync('sh', [script, described], { encoding: 'utf8' }).trim() };
}

/**
 * Semantic version precedence, enough for the comparisons here.
 *
 * Written out rather than pulled in: this file exists to check a versioning
 * rule, and checking it with a dependency that implements the same rule would
 * be checking that two copies agree.
 */
function compare(left, right) {
  const split = (version) => {
    const [core, pre] = version.split('-', 2);
    return {
      core: core.split('.').map(Number),
      pre: pre === undefined ? null : pre.split('.'),
    };
  };

  const a = split(left);
  const b = split(right);

  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }

  // A version with a pre-release is lower than one without.
  if (a.pre === null && b.pre === null) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;

  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;

    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (numeric) return Number(x) < Number(y) ? -1 : 1;
    // Numeric identifiers rank lower than alphanumeric ones.
    if (/^\d+$/.test(x)) return -1;
    if (/^\d+$/.test(y)) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const failures = [];

/** Every build of main must sort above the tag it follows. */
const cases = [
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
