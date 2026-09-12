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
  // The client never sends this shape: "put everything back to unread" is not
  // an act the interface offers, and the route refuses it so that a caller
  // typing the request by hand gets an answer rather than a surprise.
  'ids_required',
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
  // The share-link unlock route (ADR-0186) answers a fire-and-forget fetch: the
  // client submits the password to the sync connection, calls unlock to set the
  // HTTP cookie, and ignores the reply — the sync path is what shows an error to
  // the person. So these three are never rendered.
  'no_password',
  'password_required',
  'sign_in_required',
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
    else if (/\.tsx?$/.test(entry.name)) out.push(readFileSync(child, 'utf8'));
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

/**
 * Every placeholder a message needs is supplied where it is used.
 *
 * German needs placeholders English does not — `{werden}` against `{wird}`,
 * `{ihn}` against `{sie}`, formal against familiar — so this checks against the
 * *union* of what the two catalogues want rather than asserting they match. A
 * strict parity check would have called five deliberate differences faults.
 *
 * ICU messages are skipped, not read: `{sorted, select, yes {{filters, plural,
 * =0 {sortiert}}}}` holds the *word* "sortiert" inside a branch, and a naive
 * brace scan calls that a placeholder. My first version did, and reported it as
 * a missing argument for a message that is correct.
 */
test('a message asks for nothing its callers do not supply', () => {
  const catalogue = (file: string): Map<string, Set<string> | null> => {
    const source = readFileSync(new URL(`../src/i18n/${file}`, import.meta.url), 'utf8');
    const out = new Map<string, Set<string> | null>();
    for (const match of source.matchAll(/^ {2}'([\w.]+)':((?:.|\n)*?)(?=\n {2}'[\w.]+':|\n\};)/gm)) {
      const body = match[2] ?? '';
      if (body.includes(', plural,') || body.includes(', select,')) {
        out.set(match[1] ?? '', null);
        continue;
      }
      out.set(match[1] ?? '', new Set([...body.matchAll(/\{(\w+)\}/g)].map((one) => one[1] ?? '')));
    }
    return out;
  };

  const en = catalogue('messages.en.ts');
  const de = catalogue('messages.de.ts');
  const needed = new Map<string, Set<string>>();
  for (const key of en.keys()) {
    const a = en.get(key);
    const b = de.get(key);
    if (a === null || b === null || b === undefined) continue;
    needed.set(key, new Set([...a, ...b]));
  }
  assert.ok(needed.size > 500, 'the messages were read');

  let code = '';
  // The same walker the first test uses, which is named for the server because
  // that is what it was written for — it takes a directory and does not care.
  for (const source of serverSources(new URL('../src/', import.meta.url))) {
    code += `${source}\n`;
  }

  const missing: string[] = [];
  for (const call of code.matchAll(/t\(\s*'([\w.]+)'\s*,\s*\{([^{}]*)\}/g)) {
    const key = call[1] ?? '';
    const given = new Set(
      (call[2] ?? '')
        .split(',')
        .map((piece) => piece.trim().split(':')[0]?.trim() ?? '')
        .filter((name) => name !== ''),
    );
    for (const name of needed.get(key) ?? []) {
      if (!given.has(name)) missing.push(`${key} needs ${name}`);
    }
  }

  assert.deepEqual([...new Set(missing)], [], 'placeholders no caller supplies');
});
