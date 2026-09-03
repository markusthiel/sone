/**
 * Every refusal the server can send has something to say.
 *
 * `messageFor` looks up `error.<code>`, and a code without one shows "an
 * unknown error occurred". Eleven codes I added over the last few days had
 * none, so every refusal in the relation, rollup and formula work read as an
 * unknown error — found by counting, not by using the interface.
 *
 * The list below is a ratchet: what is already unmessaged is named and allowed,
 * and a *new* code fails. Sixty were missing when this was written and
 * twenty-four were worth writing immediately; the rest are named with a reason
 * rather than swept.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Codes with no message, on purpose.
 *
 * Three reasons, and each one is why sweeping them would have been wrong:
 *
 * - **Never shown.** `internal`, `method_not_allowed`, `not_found`,
 *   `not_authenticated`, `not_authorized`, `session_not_found`, `expired`,
 *   `forbidden`, `invalid_body`: the client redirects, retries or has its own
 *   wording for these, and a catalogue entry would be a second answer.
 * - **Single sign-on setup.** The `oidc*` and issuer codes are read by whoever
 *   configured the instance, from a screen that shows the raw code because that
 *   is what they will paste into a search.
 * - **Should not be reachable.** `field_not_added`, `view_not_added`,
 *   `field_not_removed`: a write the document refused after the request was
 *   already validated. If one of these ever appears, the message wanted is a
 *   bug report and not a sentence.
 */
const UNMESSAGED = new Set([
  'expired',
  'field_not_added',
  'field_not_found',
  'field_not_removed',
  'file_not_found',
  'forbidden',
  'internal',
  'invalid_access',
  'invalid_body',
  'invalid_invitation',
  'invalid_kind',
  'invalid_options',
  'invalid_state',
  'issuer_not_https',
  'maintenance_not_available',
  'method_not_allowed',
  'name_mismatch',
  'no_account_here',
  'no_client_secret',
  'no_code',
  'no_pending_sign_in',
  'not_a_group',
  'not_authenticated',
  'not_authorized',
  'not_configured',
  'not_found',
  'not_ready',
  'option_needs_an_id',
  'session_not_found',
  'state_mismatch',
  'token_not_recoverable',
  'unknown_original',
  'unknown_setting',
  'view_not_added',
  'view_not_found',
  'workspace_required',
]);

function serverSources(dir: URL): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) out.push(...serverSources(child));
    else if (entry.name.endsWith('.ts')) out.push(readFileSync(child, 'utf8'));
  }
  return out;
}

test('a code the server can answer with has a message, or is named as not having one', () => {
  const en = readFileSync(new URL('../src/i18n/messages.en.ts', import.meta.url), 'utf8');

  const codes = new Set<string>();
  for (const source of serverSources(new URL('../../server/src/', import.meta.url))) {
    for (const match of source.matchAll(/ctx\.fail\(\s*\d{3}\s*,\s*'([a-z_]+)'/g)) {
      codes.add(match[1] ?? '');
    }
  }

  assert.ok(codes.size > 50, 'the codes were found');
  const missing = [...codes].filter(
    (code) => !en.includes(`'error.${code}'`) && !UNMESSAGED.has(code),
  );
  assert.deepEqual(missing.sort(), [], 'codes with neither a message nor a reason');
});

test('the German catalogue says the same things as the English one', () => {
  // A message in one and not the other is a sentence somebody sees in the wrong
  // language, which is worse than the code.
  const en = readFileSync(new URL('../src/i18n/messages.en.ts', import.meta.url), 'utf8');
  const de = readFileSync(new URL('../src/i18n/messages.de.ts', import.meta.url), 'utf8');
  const keys = [...en.matchAll(/^ {2}'(error\.[a-z_]+)':/gm)].map((m) => m[1] ?? '');
  assert.ok(keys.length > 20);
  for (const key of keys) {
    assert.ok(de.includes(`'${key}':`), `${key} is translated`);
  }
});
