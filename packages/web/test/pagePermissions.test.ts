/**
 * Who may reach a page, in the sharing dialog.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { en } from '../src/i18n/messages.en.ts';
import { codeOf } from './helpers/source.ts';

const panel = codeOf(new URL('../src/components/PagePermissions.tsx', import.meta.url));
const dialog = codeOf(new URL('../src/components/ShareDialog.tsx', import.meta.url));

test('access for people inside sits with links for people outside', () => {
  // The same question asked twice — who gets to see this — and answering it in
  // two places is how somebody sets one and believes they have set the other.
  assert.match(dialog, /<PagePermissions pageId=\{pageId\}/);
});

test('an inherited grant is shown but not editable here', () => {
  // Editing it here would silently change access to everything else under the
  // ancestor it was set on.
  assert.match(panel, /grant\.inheritedFrom \?/);
  assert.match(panel, /from\{' '\}/);
});

test('somebody who may read but not manage gets no panel, not an error', () => {
  // They are not doing anything wrong by opening the dialog.
  assert.match(panel, /err\.code === 'forbidden' \|\| err\.code === 'not_found'/);
});

test('restricting explains that admins keep access', () => {
  // Otherwise it reads as a lock that locks everybody out, and somebody has to
  // be able to undo it.
  assert.match(panel, /Owners and admins still can/);
});

test('the panel says which direction a grant moves access', () => {
  // A grant on an unrestricted page widens and never narrows, which is not
  // obvious from a dropdown that lists "can view" under somebody who can
  // already edit.
  assert.match(panel, /never less/);
});

// --- groups -----------------------------------------------------------------

const groupsPanel = codeOf(new URL('../src/components/GroupsPanel.tsx', import.meta.url));

test('groups are listed above people in the sharing panel', () => {
  // Granting a group is the thing that scales, and listing it second would make
  // the page-by-page, person-by-person habit the obvious one — which is exactly
  // what groups exist to replace.
  // The headings are keys now (ADR-0041); the order is what this test is about.
  const groupsAt = panel.indexOf("t('perm.groups')");
  const peopleAt = panel.indexOf("t('perm.people')");
  assert.ok(groupsAt > 0 && groupsAt < peopleAt);
});

test('managing a group is separate from granting it access', () => {
  // Naming sets of people is how a workspace is organised, not something to
  // decide while looking at one page.
  assert.doesNotMatch(groupsPanel, /grantPageAccess/);
  assert.match(panel, /grantPageAccessToGroup/);
});

test('deleting a group with grants asks, with the number', () => {
  // "This group has access to four pages" is a different decision from "delete
  // this group", and finding out afterwards means finding out from somebody who
  // can no longer open one of them.
  assert.match(groupsPanel, /err\.code === 'grants_exist'/);
  assert.match(groupsPanel, /window\.confirm/);
});

test('the panel says why keeping a group up to date matters', () => {
  // Somebody who joins later gets the access too, which is the whole reason to
  // grant a group rather than four people.
  // The sentence is in the catalogue now (ADR-0041); what this test means is that
  // the panel explains why a group is worth keeping up to date.
  assert.match(groupsPanel, /t\('group\.note'\)/);
  assert.match(en['group.note'], /including whoever joins later/);
});

// --- the ceiling (ADR-0087) -------------------------------------------------

test('the ceiling sits below the restriction and above the list', () => {
  /*
   * The order the three layers apply in: the workspace default, then what is
   * given to the people below, then the ceiling over all of it.
   *
   * Placement is the argument. A control that *lowers*, set among controls that
   * raise, reads as one of them — and this is the only rule in SONE that takes
   * something away.
   */
  const restrictedAt = panel.indexOf("t('perm.onlyAdded')");
  const capAt = panel.indexOf("t('cap.label')");
  const listAt = panel.indexOf('permission-list');

  assert.ok(restrictedAt > 0 && capAt > restrictedAt, 'below the restriction');
  assert.ok(listAt > capAt, 'and above the people it limits');
});

test('a ceiling from a section above says where it came from', () => {
  /*
   * The price ADR-0087 accepted for this layer, and the condition under which
   * it is tolerable.
   *
   * A capped page looks like every other page and behaves differently. Somebody
   * who cannot edit it will look at the list of people, find themselves with
   * edit access, and have no way to reach the rule that actually decided — it
   * is on a page further up that they may never open. So the panel names it.
   */
  assert.match(panel, /inheritedCap && \(/);
  assert.match(panel, /t\('cap\.inherited', \{/);
  assert.match(en['cap.inherited'], /\{from\}/, 'and the message carries the page it is set on');
});

test('the ceiling offers no "admin", because that would be no ceiling', () => {
  // The list is viewer, commenter, editor — and "none" at the top. Offering
  // `admin` would be a control that does nothing, which is the exact shape of
  // failure this whole area keeps producing.
  assert.match(panel, /\['viewer', 'commenter', 'editor'\] as const/);
  assert.match(panel, /t\('cap\.none'\)/);
});
