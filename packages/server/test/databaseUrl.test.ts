/**
 * The connection string is checked before `pg` sees it.
 *
 * `pg` reports an unparseable connection string as "Invalid URL" — no variable
 * name, no cause. The cause, on the server where this was found, was a
 * `POSTGRES_PASSWORD` from `openssl rand -base64 32` containing a `/`, spliced
 * unencoded into the URL by compose. The server must name the variable and the
 * fix instead.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ConfigError, loadConfig } from '../src/config.js';

const BASE: Record<string, string> = {
  SONE_SECRET_KEY: 'a-test-instance-secret-key-of-sufficient-length',
};

describe('SONE_DATABASE_URL', () => {
  test('a plain password passes through untouched', () => {
    const url = 'postgres://sone:0f3a9c@db:5432/sone';
    assert.equal(loadConfig({ ...BASE, SONE_DATABASE_URL: url }).databaseUrl, url);
  });

  test('a base64 password with a slash is refused, naming the variable and the fix', () => {
    assert.throws(
      () =>
        loadConfig({ ...BASE, SONE_DATABASE_URL: 'postgres://sone:ab/cd+ef==@db:5432/sone' }),
      (err: unknown) =>
        err instanceof ConfigError &&
        /SONE_DATABASE_URL/.test(err.message) &&
        /POSTGRES_PASSWORD/.test(err.message) &&
        /openssl rand -hex 32/.test(err.message),
    );
  });

  test('a percent-encoded password is fine', () => {
    const url = 'postgres://sone:ab%2Fcd@db:5432/sone';
    assert.equal(loadConfig({ ...BASE, SONE_DATABASE_URL: url }).databaseUrl, url);
  });
});
