/**
 * What a row is, in the two modes that list things (ADR-0071).
 *
 * Both were lists of records: one notification per row, one deleted entry per
 * row, and nothing to do with either but open it. Stage three of ADR-0069 is
 * about making them lists somebody can work down — which starts with a row
 * standing for the thing a person is actually dealing with.
 *
 * These run the functions rather than reading the source, because the grouping
 * and the filtering are arithmetic and arithmetic can be wrong in ways a
 * regular expression cannot see. The source checks below are for the promises
 * that are about *where* something is drawn, which is not arithmetic.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupsIn, itemsIn } from '../src/components/InboxPanel.tsx';
import { entriesIn } from '../src/components/TrashPanel.tsx';
import type { InboxItem } from '../src/hooks/useInbox.ts';
import type { TrashEntry } from '../src/api/client.ts';
import { codeOf } from './helpers/source.ts';

// Newest first, as the server sends them.
function item(over: Partial<InboxItem> & { id: string }): InboxItem {
  return {
    kind: 'reply',
    excerpt: '',
    createdAt: '2026-09-01T10:00:00Z',
    read: false,
    pageId: 'p1',
    pageTitle: 'Seite',
    threadId: null,
    workspaceId: 'w1',
    workspaceName: 'natec',
    ...over,
  };
}

test('three replies in one thread are one row', () => {
  // The whole point of an inbox is being read top to bottom, and it cannot be
  // if one lively discussion fills it.
  const groups = groupsIn(
    [
      item({ id: 'c', threadId: 't1', excerpt: 'zuletzt' }),
      item({ id: 'b', threadId: 't1', excerpt: 'davor' }),
      item({ id: 'a', threadId: 't1', excerpt: 'zuerst' }),
    ],
    { of: 'all' },
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.items.length, 3);
  // The newest is what the row says, and the group sits where the newest was:
  // a thread that just spoke is at the top.
  assert.equal(groups[0]!.latest.excerpt, 'zuletzt');
  assert.equal(groups[0]!.unread, 3);
});

test('a mention is never folded into a thread', () => {
  /*
   * Two mentions in one thread are two things somebody was called into by
   * name, not one thing repeated — which is exactly the difference between
   * being addressed and being copied in. The same for an assignment.
   */
  const groups = groupsIn(
    [
      item({ id: 'm1', kind: 'mention', threadId: 't1' }),
      item({ id: 'm2', kind: 'mention', threadId: 't1' }),
      item({ id: 'r1', kind: 'reply', threadId: 't1' }),
    ],
    { of: 'all' },
  );
  assert.equal(groups.length, 3);
});

test('a reply with no thread is its own row', () => {
  // Grouping on a null id would fold every loose notification into one row.
  const groups = groupsIn([item({ id: 'a' }), item({ id: 'b' })], { of: 'all' });
  assert.equal(groups.length, 2);
});

test('grouping happens after filtering, never before', () => {
  /*
   * Otherwise a thread spanning a read and an unread notification would appear
   * in the unread view carrying the read one with it — and the row would say
   * "2" over a view that promised one thing waiting.
   */
  const items = [
    item({ id: 'new', threadId: 't1' }),
    item({ id: 'old', threadId: 't1', read: true }),
  ];
  const unread = groupsIn(items, { of: 'unread' });
  assert.equal(unread.length, 1);
  assert.equal(unread[0]!.items.length, 1, 'only the one that is waiting');
  assert.equal(groupsIn(items, { of: 'all' })[0]!.items.length, 2, 'both, in the full list');
});

test('the menu counts rows, not notifications', () => {
  // A menu saying 7 over a list of 4 rows is a menu that looks wrong, and the
  // row is what somebody is about to deal with.
  const items = [
    item({ id: 'a', threadId: 't1' }),
    item({ id: 'b', threadId: 't1' }),
    item({ id: 'c', threadId: 't1' }),
    item({ id: 'd' }),
  ];
  assert.equal(itemsIn(items, { of: 'unread' }).length, 4, 'four notifications');
  assert.equal(groupsIn(items, { of: 'unread' }).length, 2, 'two rows');

  const panel = codeOf(new URL('../src/components/InboxPanel.tsx', import.meta.url));
  assert.match(panel, /groupsIn\(all, \{ of: 'unread' \}\)\.length/);
  assert.doesNotMatch(panel, /all\.filter\(\(one\) => !one\.read\)\.length/);
});

test('the keys move the focus rather than a selection of their own', () => {
  /*
   * Then Enter, scrolling into view and the screen reader's announcement all
   * come from the browser and cannot disagree with what is on screen — and a
   * drawn selection that the browser does not know about is exactly how those
   * three come apart.
   */
  const screen = codeOf(new URL('../src/components/InboxScreen.tsx', import.meta.url));
  assert.match(screen, /row\.focus\(\)/);
  assert.match(screen, /event\.key === 'j'/);
  assert.match(screen, /event\.key === 'k'/);
  assert.match(screen, /event\.key === 'e' \|\| event\.key === 'u'/);
  // Never while somebody is writing. An inbox that swallows "j" mid-sentence is
  // worse than one with no shortcuts at all.
  assert.match(screen, /isContentEditable/);
  assert.match(screen, /'INPUT', 'TEXTAREA', 'SELECT'/);
  // And said out loud: a shortcut nobody knows about is a shortcut nobody has.
  assert.match(screen, /t\('inbox\.keys'\)/);
});

test('marking read has an undo, and it is the same act', () => {
  // Opened by accident, or read and not dealt with. Without a way back,
  // "unread" is a one-way door and people stop clicking in the list.
  const hook = codeOf(new URL('../src/hooks/useInbox.ts', import.meta.url));
  assert.match(hook, /setRead: \(ids: string\[\], read: boolean\) => void/);
  assert.match(hook, /api\.markInboxRead\(ids\) : api\.markInboxUnread\(ids\)/);
  // Optimistic, like marking read: putting a row back has no navigation to
  // hide a round trip behind, so a row that waited would read as a key that
  // sometimes does nothing.
  assert.match(hook, /setItems\(\(current\) =>[\s\S]{0,200}\{ \.\.\.one, read \}/);
});

// --- the trash ------------------------------------------------------------

function entry(over: Partial<TrashEntry> & { id: string }): TrashEntry {
  return {
    title: 'Notizen',
    kind: 'page',
    archivedAt: new Date().toISOString(),
    descendants: 0,
    parentMissing: false,
    ...over,
  };
}

test('searching the trash narrows the view rather than replacing it', () => {
  /*
   * A query that silently left the chosen view would answer a question nobody
   * asked — and the counts beside the view names come from this same function,
   * so they move while somebody types.
   */
  const entries = [
    entry({ id: 'a', title: 'Prüfung', kind: 'page' }),
    entry({ id: 'b', title: 'Prüfungsordner', kind: 'folder' }),
    entry({ id: 'c', title: 'Anderes', kind: 'page' }),
  ];
  assert.deepEqual(
    entriesIn(entries, 'page', 'prüf').map((one) => one.id),
    ['a'],
    'the query and the view, both',
  );
  assert.equal(entriesIn(entries, 'recent', '').length, 3, 'and nothing without a query');
});

test('the search folds case and accents', () => {
  // Somebody looking for a thing they deleted a fortnight ago half-remembers
  // its name, which is the whole reason the field exists.
  const entries = [entry({ id: 'a', title: 'Prüfung' })];
  assert.equal(entriesIn(entries, 'recent', 'prufung').length, 1);
  assert.equal(entriesIn(entries, 'recent', 'PRÜF').length, 1);
  assert.equal(entriesIn(entries, 'recent', 'xyz').length, 0);
});

test('an entry whose folder is gone asks where before it acts', () => {
  /*
   * Pressing "restore" and getting an error is not an answer anybody can do
   * anything with. The listing has marked these rows since ADR-0027 and nothing
   * used the mark — the button says what will happen instead.
   */
  const trash = codeOf(new URL('../src/components/Trash.tsx', import.meta.url));
  assert.match(trash, /entry\.parentMissing && entry\.kind !== 'folder'\s*\n?\s*\? setChoosing\(entry\)/);
  assert.match(trash, /t\('trash\.restoreTo'\)/);
  // And the refusal is still handled, for the folder deleted by somebody else
  // while this page was open.
  assert.match(trash, /err\.code === 'parent_missing'/);

  // The dialog offers the root only for a folder: a page at a workspace's root
  // is not a shape the schema allows (ADR-0019), and the server refuses one.
  const dialog = codeOf(new URL('../src/components/RestoreDialog.tsx', import.meta.url));
  assert.match(dialog, /entry\.kind === 'folder'\s*\n?\s*\? \[\{ id: null/);
});

test('a deleted entry can be read before the decision about it', () => {
  /*
   * Restoring is a decision and a title is not enough to make it. Opening it is
   * not an option: an archived page is not in the tree and the editor cannot
   * reach it.
   */
  const trash = codeOf(new URL('../src/components/Trash.tsx', import.meta.url));
  assert.match(trash, /api\s*\n?\s*\.pagePreview\(entry\.id\)/);
  // Text, never the page: a preview that rendered the document would be a
  // second renderer to keep in step with the first.
  assert.doesNotMatch(trash, /EditorSurface|PageView/);
  // A folder holds no text of its own, so it is offered nothing to read.
  assert.match(trash, /entry\.kind !== 'folder' && \(/);
  // Kept once read — the page is archived and cannot have changed, so a second
  // request would be a request for nothing.
  assert.match(trash, /if \(previews\[entry\.id\]\) return;/);
  // A preview that fails is its own state, not the page's: it must not look
  // like the trash itself having failed.
  assert.match(trash, /\{ state: 'failed' \}/);
});

test('the trash says which nothing it is showing', () => {
  // "Nothing in the trash" while thirty things sit in another view is untrue,
  // and it is the kind of untrue that makes somebody stop looking.
  const trash = codeOf(new URL('../src/components/Trash.tsx', import.meta.url));
  assert.match(trash, /t\('trash\.empty'\)/);
  assert.match(trash, /t\('trash\.emptyView'\)/);
  assert.match(trash, /t\('trash\.noMatch', \{ query \}\)/);
});

test('nothing in the trash is written in English any more', () => {
  /*
   * It had four sentences built in code — "deleted", "with N entries inside",
   * "the folder it was in is gone", "Untitled folder" — in a screen whose every
   * other line is translated (ADR-0041). Found by reading it in German.
   */
  const trash = codeOf(new URL('../src/components/Trash.tsx', import.meta.url));
  // The four sentences as they were written, rather than the words in them: a
  // word can appear in an identifier, and a test that matches those is a test
  // that fails on a rename.
  for (const sentence of [
    /'Untitled folder'/,
    /entr\$\{/,
    /deleted \$\{/,
    /the folder it was in is gone/,
  ]) {
    assert.doesNotMatch(trash, sentence, String(sentence));
  }
  // And what replaced them, which is the part that would go missing if somebody
  // "simplified" the row later.
  for (const key of ['trash.deletedAt', 'trash.withInside', 'trash.folderGone']) {
    assert.match(trash, new RegExp(`t\\('${key.replace('.', '\\.')}'`), key);
  }
});
