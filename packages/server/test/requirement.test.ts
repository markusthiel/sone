/**
 * Where an account stands against the requirement (ADR-0065).
 *
 * The three questions ADR-0063 said were the actual feature — who is exempt,
 * how long, and what happens then — are all here, so this is where they are
 * tested.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import {
  GRACE_DAYS,
  reachableWhileBlocked,
  standingOf,
} from '../src/auth/requirement.js';

const off = { required: false, since: '' };
const on = (daysAgo: number) => ({
  required: true,
  since: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
});

const withPassword = { hasSecondFactor: false, hasPassword: true };

test('nothing is asked when the requirement is off', () => {
  assert.deepEqual(standingOf(off, withPassword), { kind: 'fine' });
});

test('nobody is blocked on the day it is switched on', () => {
  /*
   * An instance that locks out whoever was on holiday is an instance whose
   * administrator spends a week removing factors by hand — and each of those
   * removals is the exact act this feature exists to prevent, done under
   * pressure (ADR-0065).
   */
  const standing = standingOf(on(0), withPassword);
  assert.equal(standing.kind, 'grace');
});

test('after the grace period, enrolment is the only way forward', () => {
  assert.deepEqual(standingOf(on(GRACE_DAYS + 1), withPassword), { kind: 'blocked' });
  // And the day before is still grace, so the boundary is where it says.
  assert.equal(standingOf(on(GRACE_DAYS - 1), withPassword).kind, 'grace');
});

test('a single sign-on account is exempt, however long it has been', () => {
  // Requiring TOTP of an account that authenticates elsewhere is a second
  // factor on top of somebody else's first one.
  const provider = { hasSecondFactor: false, hasPassword: false };
  assert.deepEqual(standingOf(on(GRACE_DAYS + 100), provider), { kind: 'fine' });
});

test('an account that has one is fine whatever the dates say', () => {
  const enrolled = { hasSecondFactor: true, hasPassword: true };
  assert.deepEqual(standingOf(on(GRACE_DAYS + 100), enrolled), { kind: 'fine' });
});

test('a broken timestamp gives grace rather than locking everybody out', () => {
  /*
   * The failure that must not be catastrophic. A missing or unparseable `since`
   * is read as *now*, so the worst a corrupted setting costs is fourteen more
   * days — where reading it as "long ago" would lock out an entire instance
   * over a bad string.
   */
  for (const since of ['', 'gestern', 'not-a-date']) {
    const standing = standingOf({ required: true, since }, withPassword);
    assert.equal(standing.kind, 'grace', JSON.stringify(since));
  }
});

test('reading is not reachable while blocked, and enrolling is', () => {
  // The point of a second factor is that a stolen password grants nothing, and
  // a stolen password with read access to a company's notes has granted the
  // thing that mattered.
  assert.equal(reachableWhileBlocked('/api/auth/second-factor/start'), true);
  assert.equal(reachableWhileBlocked('/api/auth/second-factor/confirm'), true);
  assert.equal(reachableWhileBlocked('/api/auth/logout'), true);

  for (const path of ['/api/pages', '/api/workspaces', '/api/search', '/api/favourites']) {
    assert.equal(reachableWhileBlocked(path), false, path);
  }
});

test('the mail stages are two, and which one is due comes from the deadline', () => {
  /*
   * Two mails and not five: a feature that mails somebody daily about a thing
   * they intend to do at the weekend has taught them to filter it (ADR-0065).
   *
   * Read from the module rather than exercised against a relay, because what
   * is worth pinning here is the count and the boundary — the sending itself is
   * the same `sendMail` every other job uses.
   */
  const source = readFileSync(
    new URL('../src/jobs/requirementMails.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /'announced'/);
  assert.match(source, /'warned'/);
  assert.doesNotMatch(source, /'reminded'|'final'/, 'still only two stages');

  // Recorded before sending, so a relay that accepts and then times out costs
  // one missed mail rather than a duplicate every minute.
  const insertAt = source.indexOf('INSERT INTO requirement_mails');
  const sendAt = source.indexOf('await sendMail(');
  assert.ok(insertAt > 0 && sendAt > insertAt, 'the row is written first');

  // And only accounts that can act: a provider account is exempt, so telling
  // it to enrol would be telling somebody to do something inapplicable.
  assert.match(source, /u\.password_hash IS NOT NULL/);
});

test('one query answers both questions the session asks', () => {
  /*
   * The consolidation this file's neighbour needed.
   *
   * The session route asked twice — `hasSecondFactor` for the settings screen,
   * then a standing that read the same fact plus whether the account has a
   * password. Two queries on the route every page load hits, for facts that
   * come out of one row. I wrote that two commits before removing it, which is
   * why the assertion is here rather than in a comment.
   */
  const rule = readFileSync(new URL('../src/auth/requirement.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../src/http/auth.ts', import.meta.url), 'utf8');

  // The SQL lives once, in the module that owns the rule.
  const sql = /SELECT u\.password_hash IS NOT NULL AS has_password/g;
  assert.equal((rule.match(sql) ?? []).length, 1, 'once in the rule module');
  assert.equal((main.match(sql) ?? []).length, 0, 'and nowhere in main');

  // And the session takes both answers from the one call.
  assert.match(auth, /hasSecondFactor: standing\.facts\.hasSecondFactor/);
  assert.match(auth, /secondFactorStanding: standing\.standing/);
  assert.doesNotMatch(
    auth,
    /hasSecondFactor: await hasSecondFactor\(deps\.pool, auth\.userId\)/,
    'not asked a second time',
  );
});

test('a membership lookup lives in one place', () => {
  /*
   * The rest of the consolidation round. `SELECT role FROM workspace_members`
   * was written five times across four files — one of them already a private
   * helper called `roleIn`, which is the tell: somebody had noticed and made a
   * local answer instead of a shared one.
   *
   * Five copies of a membership lookup is five places to forget a condition the
   * day one is added, and membership is exactly the kind of thing that grows a
   * condition.
   */
  const server = new URL('../src/', import.meta.url);
  let copies = 0;
  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) walk(at);
      else if (entry.name.endsWith('.ts')) {
        const text = readFileSync(at, 'utf8');
        copies += (text.match(/SELECT role FROM workspace_members/g) ?? []).length;
      }
    }
  };
  walk(server);

  /*
   * One, and it was two.
   *
   * The shared helper's own copy is gone: `roleIn` asks
   * `loadWorkspaceStanding` now, because a role is a row and what it *gives*
   * is a column on that row rather than a switch statement (ADR-0087). What
   * remains is the one statement that asks a genuinely different question —
   * whether somebody is one of two roles, answered in the database rather than
   * by fetching a value to compare in JavaScript.
   *
   * The requirement is unchanged and this number is not the requirement: the
   * point is that a membership lookup is not copied around, and the assertion
   * counts copies so that a sixth cannot appear quietly.
   */
  assert.equal(copies, 1, 'only the one that asks something else');
});
