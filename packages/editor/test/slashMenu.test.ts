/**
 * The `/` menu's list and how it is filtered.
 *
 * The interesting property is that the filter runs over *localised* items
 * (ADR-0041): the list is matched against the title and the keywords, so a
 * German interface has to filter German ones.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SLASH_ITEMS, filterSlashItems, type SlashItem } from '../src/slashMenu.js';

test('a localised item is filtered by its localised words', () => {
  // The reason the localiser is an option on the plugin rather than something
  // the renderer does: the list is filtered by what somebody typed, matched
  // against the title and the keywords. A German interface must filter German
  // ones, or typing "übersch" finds nothing while the menu shows
  // "Überschrift 1".
  const german = (item: SlashItem): SlashItem =>
    item.id === 'heading-1'
      ? { ...item, title: 'Überschrift 1', keywords: [...item.keywords, 'überschrift'] }
      : item;

  const localised = SLASH_ITEMS.map(german);
  assert.equal(filterSlashItems('übersch', localised)[0]?.id, 'heading-1');

  // And the English keywords still match, because "h1" is typed by people in
  // every language.
  assert.equal(filterSlashItems('h1', localised)[0]?.id, 'heading-1');

  // Without the localiser the German word finds nothing, which is the bug this
  // shape avoids.
  assert.equal(filterSlashItems('übersch', SLASH_ITEMS).length, 0);
});
