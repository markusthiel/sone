/**
 * A role's name on screen (ADR-0143).
 *
 * Three components asked the same question — *is this one of the four, or a
 * name somebody typed?* — and wrote the answer three times. A fourth place,
 * `roleLabel`, did not ask it at all and returned the row's own `name`, which
 * for a system role is the English word a migration seeded. So the workspace
 * header and the workspace settings screen said **"Owner"** in a German
 * interface, and had done since roles stopped being an enum (ADR-0102).
 *
 * The decision is in `@sone/core` now, and this file holds the two things that
 * keep it there: no component builds the message key itself, and the helper
 * answers in the language of the catalogue it is handed.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { de } from '../src/i18n/messages.de.ts';
import { en } from '../src/i18n/messages.en.ts';
import { roleLabel } from '../src/workspaceRights.ts';

const srcDir = new URL('../src/', import.meta.url);

/** Every source file under `src`, with comments stripped. */
function sources(): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const at = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) walk(at, `${prefix}${entry.name}/`);
      else if (/\.tsx?$/.test(entry.name)) {
        out.push({
          name: `${prefix}${entry.name}`,
          text: readFileSync(at, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
        });
      }
    }
  };
  walk(srcDir, '');
  return out;
}

test('one place decides what a role is called', () => {
  /*
   * Read off the message key rather than off the prose: a file that builds
   * `role.${…}` is a file that decided a role is one of the four, and four
   * files deciding that separately is how one of them came to skip it.
   *
   * The catalogues are exempt — they hold the words, which is the other half
   * of the same rule.
   */
  const deciders = sources()
    .filter(({ name }) => !name.startsWith('i18n/messages.'))
    // The name, not the hint: `role.${key}.hint` is a different question —
    // *what does this role mean* — which only the four can answer, and which
    // the picker asks in one place already.
    .filter(({ text }) => /`role\.\$\{[^}]*\}`/.test(text))
    .map(({ name }) => name)
    .sort();

  assert.deepEqual(deciders, ['workspaceRights.ts']);
});

test('and it answers in the reader’s language', () => {
  // The words exist and have since ADR-0041. What was missing was anything
  // asking for them in these two screens.
  const inGerman = (key: string): string => (de as Record<string, string>)[key] ?? key;
  const inEnglish = (key: string): string => (en as Record<string, string>)[key] ?? key;

  assert.equal(roleLabel({ key: 'owner', name: 'Owner' }, inGerman), 'Eigentümer');
  assert.equal(roleLabel({ key: 'guest', name: 'Guest' }, inGerman), 'Gast');
  assert.equal(roleLabel({ key: 'owner', name: 'Owner' }, inEnglish), 'Owner');
});

// The rest of `roleLabel` — a custom name, an absent role — is in
// `workspaceRights.test.ts`, beside the module it belongs to. What is here is
// the half that needs the real catalogues.
