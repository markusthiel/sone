/**
 * Numbers that come from the environment (ADR-0111).
 *
 * Two halves. The helper, which decides what a setting is allowed to be; and
 * the guard that keeps the next reader from going around it — with a test that
 * watches the guard fail, because a guard nobody has seen catch anything is a
 * guard nobody should believe, and this project has shipped two of those
 * (ADR-0077, ADR-0084).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { envNumber, forgetRefusedEnvNumbers, refusedEnvNumbers } from '../src/env.js';

const script = fileURLToPath(new URL('../../../scripts/check-env-numbers.mjs', import.meta.url));

// --- the helper -------------------------------------------------------------

test('an unset variable is the default, and not a refusal', () => {
  forgetRefusedEnvNumbers();
  assert.equal(envNumber('SONE_NOT_SET', 24, { min: 1 }, {}), 24);
  // Empty counts as unset: `SONE_X=` in a compose file is somebody leaving it
  // blank, not somebody asking for zero — and `Number('')` is 0.
  assert.equal(envNumber('SONE_BLANK', 24, { min: 1 }, { SONE_BLANK: '  ' }), 24);
  assert.deepEqual(refusedEnvNumbers(), [], 'nothing was refused');
});

test('a number that is not a number falls back, and says so', () => {
  /*
   * The case ADR-0080 described and this file exists for. `Number('ten')` is
   * NaN, which typechecks as a number and then reaches Postgres as the string
   * "NaN minutes", or a `Date` as an Invalid Date.
   */
  forgetRefusedEnvNumbers();
  assert.equal(envNumber('SONE_HOURS', 24, {}, { SONE_HOURS: 'ten' }), 24);
  assert.deepEqual(refusedEnvNumbers(), [{ key: 'SONE_HOURS', value: 'ten' }]);
});

test('zero is refused where zero has a destructive meaning', () => {
  // Not clamped up to the minimum: an operator who asked for 0 and silently got
  // 1 believes the setting works. They get the documented default and a line in
  // the boot log naming the variable.
  forgetRefusedEnvNumbers();
  assert.equal(envNumber('SONE_DAYS', 90, { min: 1 }, { SONE_DAYS: '0' }), 90);
  assert.deepEqual(refusedEnvNumbers(), [{ key: 'SONE_DAYS', value: '0' }]);
});

test('and allowed where it is a choice somebody can make', () => {
  // `SONE_EMAIL_DELAY_MINUTES=0` is "send at once", which is a reasonable thing
  // to want. The bound belongs to the caller, not to the helper.
  forgetRefusedEnvNumbers();
  assert.equal(envNumber('SONE_DELAY', 5, { min: 0 }, { SONE_DELAY: '0' }), 0);
  assert.deepEqual(refusedEnvNumbers(), []);
});

test('a negative value is refused rather than read as a shorter interval', () => {
  /*
   * The quiet one. `now() - '-5 minutes'::interval` is five minutes in the
   * **future**, so "has this document been quiet since then" is true of
   * everything — a version of every changed page, every pass.
   */
  forgetRefusedEnvNumbers();
  assert.equal(envNumber('SONE_MINUTES', 10, { min: 1 }, { SONE_MINUTES: '-5' }), 10);
  assert.deepEqual(refusedEnvNumbers(), [{ key: 'SONE_MINUTES', value: '-5' }]);
});

test('a fraction is refused where only whole units mean anything', () => {
  forgetRefusedEnvNumbers();
  assert.equal(envNumber('SONE_MAX', 10, { min: 1, integer: true }, { SONE_MAX: '2.5' }), 10);
  assert.equal(envNumber('SONE_MAX2', 10, { min: 1 }, { SONE_MAX2: '2.5' }), 2.5, 'unless it may be');
});

test('a value above the ceiling falls back', () => {
  forgetRefusedEnvNumbers();
  assert.equal(
    envNumber('SONE_COST', 14, { min: 10, max: 20, integer: true }, { SONE_COST: '40' }),
    14,
    'a cost of 2^40 is a server that never answers a sign-in',
  );
});

test('a usable value is used', () => {
  // The counterweight. A helper that refused everything would pass every test
  // above and make every setting in the deployment guide a lie.
  forgetRefusedEnvNumbers();
  assert.equal(envNumber('SONE_OK', 24, { min: 1, integer: true }, { SONE_OK: '48' }), 48);
  assert.deepEqual(refusedEnvNumbers(), []);
});

// --- the guard --------------------------------------------------------------

const run = (source?: string): { code: number; err: string } => {
  const result = spawnSync(process.execPath, source ? [script, source] : [script], {
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, err: `${result.stderr}${result.stdout}` };
};

test('the guard fails on a number read straight from the environment', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-env-'));
  mkdirSync(path.join(dir, 'jobs'));
  writeFileSync(
    path.join(dir, 'jobs', 'runner.ts'),
    `export const HOURS = Number(process.env['SONE_JOB_RESULT_HOURS'] ?? 24);\n`,
  );

  try {
    const { code, err } = run(dir);
    assert.equal(code, 1, 'the build stops');
    assert.match(err, /jobs\/runner\.ts:1/, 'and names the line');
    assert.match(err, /envNumber/, 'and what to use instead');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it catches the other spellings of the same mistake', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-env-'));
  writeFileSync(path.join(dir, 'a.ts'), `const a = parseInt(process.env['X'] ?? '1', 10);\n`);
  writeFileSync(path.join(dir, 'b.ts'), `const b = +process.env['Y']!;\n`);

  try {
    const { code, err } = run(dir);
    assert.equal(code, 1);
    assert.match(err, /a\.ts:1/);
    assert.match(err, /b\.ts:1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('and it leaves the file that is allowed to do it alone', () => {
  // `env.ts` is where the rule lives, so it is the one place the construction
  // has to appear. A guard that failed there would have no way to be satisfied.
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-env-'));
  writeFileSync(path.join(dir, 'env.ts'), `const n = Number(process.env['X']);\n`);

  try {
    assert.equal(run(dir).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty tree is refused rather than passed', () => {
  /*
   * Zero files scanned is trivially "no offences", so a checker written the
   * obvious way reports success when its path is wrong — which is how a guard
   * becomes decoration without anybody editing it. The same hole
   * `check-rights-enforced.mjs` closes for an emptied enumeration.
   */
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-env-'));
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
