/**
 * What the caller may do in a workspace, asked the way the server asks
 * (ADR-0102).
 *
 * The screen decided from `role === 'owner' || role === 'admin'`, and the route
 * decides from the `workspace.settings` right. The two agreed for exactly as
 * long as the four system roles were the only roles.
 *
 * The same shape as `entryRights.test.tsx` one layer out, and it exists for the
 * same reason ADR-0095 gives: **a disabled control produces no failure to
 * read.** Nothing goes red when an interface is stricter than its server —
 * somebody just cannot do their job, and there is nothing in a log about it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { mayEditWorkspace, roleLabel } from '../src/workspaceRights.ts';

const ws = (rights: string[], role = 'custom', roleName = 'Redaktion') =>
  ({ rights, role, roleName }) as never;

describe('who may change a workspace', () => {
  test('the right decides, not the word', () => {
    /*
     * The case that was broken and that nothing could report. The word on this
     * membership is `custom` — and before ADR-0102 it was `member`, because
     * assigning a custom role wrote "the nearest of the four words".
     */
    assert.equal(mayEditWorkspace(ws(['workspace.settings']), false), true);
    assert.equal(mayEditWorkspace(ws([]), false), false);
  });

  test('a right held for something else is not this one', () => {
    // The whole point of rights being a set (ADR-0087): somebody who may add
    // people is not thereby somebody who may rename the place.
    assert.equal(mayEditWorkspace(ws(['people.manage', 'groups.manage']), false), false);
  });

  test('an owner still may, because an owner holds the right', () => {
    // The counterweight. A cleanup that quietly took this away from owners
    // would be worse than the fault it fixed.
    assert.equal(
      mayEditWorkspace(ws(['workspace.settings', 'people.manage'], 'owner', 'Owner'), false),
      true,
    );
  });

  test('and the instance right still reaches a workspace nobody is in', () => {
    /*
     * The half that was fixed one ADR earlier, kept: an administrator opening a
     * foreign workspace has no membership and no standing, and the route
     * accepts them anyway. `undefined` is exactly what the screen holds then.
     */
    assert.equal(mayEditWorkspace(undefined, true), true);
    assert.equal(mayEditWorkspace(undefined, false), false);
    assert.equal(mayEditWorkspace(ws([]), true), true, 'a member who administers everything');
  });
});

describe('what the role is called', () => {
  /** Standing in for a catalogue; the real ones are checked in `roleNames`. */
  const say = (key: string): string =>
    ({ 'role.owner': 'Eigentümer', 'role.guest': 'Gast' })[key] ?? key;

  test('a custom role is named, not translated into the nearest word', () => {
    assert.equal(roleLabel({ key: 'custom', name: 'Redaktion' }, say, 'unbekannt'), 'Redaktion');
  });

  test('but a system role is named by the word this application wrote', () => {
    /*
     * **This test used to assert the opposite**, under the heading *"a system
     * role keeps its own name"* — true of the code and wrong about the product
     * (ADR-0143). `roles.name` for the four is the English word a migration
     * seeded; nobody chose it, and returning it put "Owner" in a German
     * interface on the two screens that used this helper.
     *
     * Rewritten rather than deleted, like every other red test holding a
     * replaced decision here (ADR-0118).
     */
    assert.equal(roleLabel({ key: 'owner', name: 'Owner' }, say, 'unbekannt'), 'Eigentümer');
  });

  test('and a workspace nobody fetched says so rather than guessing', () => {
    assert.equal(roleLabel(undefined, say, 'unbekannt'), 'unbekannt');
    // Nor the key: it ended `?? workspace?.role`, so a half-loaded summary
    // showed the system word `member`, lower-case and in English.
    assert.equal(roleLabel({ key: '', name: '' }, say, 'unbekannt'), 'unbekannt');
  });
});
