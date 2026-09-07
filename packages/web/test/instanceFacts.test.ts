/**
 * What the interface claims about this instance (ADR-0139).
 *
 * `canSendMail` has been on the instance payload since ADR-0059, typed in the
 * client, read in `App`, and used by the sign-in screen and the share dialog.
 * Its own comment records a second reader arriving and says that two fields
 * carrying one boolean is *"the duplication this codebase keeps removing"*.
 *
 * Two things had gone wrong beside it anyway:
 *
 * - the empty inbox said **"SONE does not send email"** unconditionally, which
 *   was true when it was written and false since ADR-0058 — so it denied what
 *   the share dialog three clicks away was offering, on the same instance;
 * - and ADR-0138 left the export screen silent, on a written belief that the
 *   interface had no way to know. It had.
 *
 * So this file holds the two properties that would have caught both: every
 * claim about mail asks first, and not knowing is never a promise.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const componentsDir = new URL('../src/components/', import.meta.url);
const components = readdirSync(componentsDir).filter((name) => /\.tsx?$/.test(name));

const sourceOf = (name: string): string =>
  readFileSync(new URL(name, componentsDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the instance is asked, not threaded', () => {
  /*
   * The argument is the one `App` already made for the logo, quoted in
   * `Instance.tsx`: four routes to a fact are four chances for two screens to
   * show different answers. That is not hypothetical here — it is what the
   * inbox and the share dialog were doing.
   */
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /<Instance\b/, 'provided once, above everything');
  assert.match(app, /canSendMail: instance\?\.canSendMail === true/);

  // And no component takes it as a prop, which is the shape that lets two of
  // them disagree.
  for (const name of components) {
    if (name === 'Instance.tsx') continue;
    const source = sourceOf(name);
    assert.doesNotMatch(
      source,
      /canSendMail\??:\s*boolean/,
      `${name} takes canSendMail as a prop rather than asking for it`,
    );
  }
});

test('not knowing is never a promise', () => {
  /*
   * The field is optional on the payload: an older server does not send it, and
   * neither does one whose instance request has not landed yet. `undefined`
   * must read as "no", because the failure directions are not symmetrical — a
   * screen that stays quiet about mail on an instance that sends it is a missed
   * sentence, and one that promises mail on an instance with no relay is a lie
   * somebody waits on.
   */
  const context = codeOf(new URL('../src/components/Instance.tsx', import.meta.url));
  assert.match(context, /createContext<InstanceFacts>\(\{ logo: null, canSendMail: false \}\)/);

  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /instance\?\.canSendMail === true/, 'compared, not coerced');
  assert.doesNotMatch(app, /canSendMail: instance\?\.canSendMail,/, 'and never passed through');
});

test('every screen that claims something about mail asks first', () => {
  /*
   * The general form, and the one that would have caught the inbox.
   *
   * Read off the message keys rather than off the prose: a component that
   * renders a sentence about mail without `canSendMail` in the same file is
   * making a claim it has not checked. The two keys that *are* the answer to
   * the question — one for each side — are exempt, because naming them is what
   * asking looks like.
   */
  const claims = /'(inbox\.noEmail|inbox\.andEmail|workspace\.export\.willMail)'/;

  for (const name of components) {
    const source = sourceOf(name);
    if (!claims.test(source)) continue;
    assert.match(
      source,
      /canSendMail/,
      `${name} says something about mail without asking whether this instance sends any`,
    );
  }
});
