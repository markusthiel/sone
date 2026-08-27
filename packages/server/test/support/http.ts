/**
 * HTTP assertions for tests.
 *
 * `expectStatus` exists because passing `await res.text()` as an assertion
 * message reads the response body unconditionally, so a later `.json()` fails
 * with "Body is unusable: Body has already been read" — and that error then
 * masks the real failure entirely.
 *
 * That mistake has now been made twice in two different test files, which is
 * why it lives here instead of being remembered.
 */

import assert from 'node:assert/strict';

export async function expectStatus(res: Response, expected: number): Promise<void> {
  if (res.status === expected) return;
  // Read the body only on failure, where it is genuinely wanted.
  const body = await res.text().catch(() => '<unreadable>');
  assert.fail(`expected ${expected}, got ${res.status}: ${body}`);
}

/** Parse a JSON body, failing with the raw text if it is not JSON. */
export async function expectJson<T>(res: Response, expected = 200): Promise<T> {
  const text = await res.text();
  if (res.status !== expected) {
    assert.fail(`expected ${expected}, got ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return assert.fail(`expected JSON, got: ${text.slice(0, 300)}`);
  }
}
