/**
 * What signing out has to take with it (ADR-0178).
 *
 * `useSession`'s logout already says the rule, beside the line that clears the
 * local documents:
 *
 * > Signing out and leaving somebody's documents in the browser is the failure
 * > this guards against: the next person at that machine would find them in
 * > storage, readable without any credential at all.
 *
 * **Logout does not reload the page.** It revokes the cookie, clears
 * `localStorage`, clears the local documents and re-fetches the session — so a
 * module-level variable outlives it, and anything cached in one is still there
 * for whoever signs in next in that tab.
 *
 * ADR-0176 added exactly such a cache: every page title across every workspace
 * the *previous* person was a member of. It shipped with a `forgetLinkTargets`
 * written for this and called from nowhere.
 *
 * So this is a census rather than one assertion. A cache added later has to join
 * the list on purpose, and being made to edit this file is the moment to notice
 * that it holds something about a person.
 */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const session = codeOf(new URL('../src/hooks/useSession.ts', import.meta.url));

/** The body of `logout`, which is where everything per-person is let go. */
const logout = (): string => {
  const at = session.indexOf('const logout = useCallback');
  assert.notEqual(at, -1, 'logout is still called that');
  const rest = session.slice(at);
  const end = rest.indexOf('}, [reload]);');
  assert.notEqual(end, -1, 'and still ends where it did');
  return rest.slice(0, end);
};

test('the documents go', () => {
  // The oldest of these, and the one whose comment states the rule.
  assert.match(logout(), /await clearLocalDocs\(\);/);
});

test('the remembered workspace goes', () => {
  assert.match(logout(), /localStorage\.removeItem\(LAST_WORKSPACE_KEY\)/);
});

test('and the pages a picker was holding go with them', () => {
  /*
   * Titles from every workspace the person was a member of, kept in a
   * module-level cache so `[[` never pauses while somebody types (ADR-0176).
   * That cache survives a logout, because a logout is not a reload — and the
   * next person to type `[[` in that tab would be offered somebody else's
   * workspace.
   */
  assert.match(logout(), /forgetLinkTargets\(\)/);
});

test('and whether there is a SOTE server goes', () => {
  // Answered by a route that requires a session, and cached at module scope
  // so the `/` menu can ask synchronously (ADR-0188). Not about a person, but
  // learned as one — so it is let go with the rest.
  assert.match(logout(), /forgetSoteAvailability\(\)/);
});

test('every module-level cache in the app is in that list', () => {
  /*
   * The census, and the reason this test is worth more than the three above.
   *
   * A cache at module scope outlives a logout by construction. Each of these
   * has to be let go by name; a new one is a new line here, and being made to
   * add it is the moment to ask what it is holding.
   */
  const dir = new URL('../src/hooks/', import.meta.url);
  const names = readdirSync(dir);
  const withCache = names.filter((name) => {
    if (!name.endsWith('.ts')) return false;
    const source = codeOf(new URL(name, dir));
    // A mutable binding at column zero: module scope, and it survives a remount.
    return /^let [a-zA-Z]/m.test(source);
  });
  assert.deepEqual(withCache.sort(), ['useLinkTargets.ts', 'useSoteAvailable.ts'], 'caches to let go of');
});
