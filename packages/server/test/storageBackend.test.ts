/**
 * A storage backend that was configured, validated, documented — and absent
 * (ADR-0107).
 *
 * `SONE_STORAGE_BACKEND=s3` is accepted. `loadConfig` then **requires** four S3
 * settings and validates a fifth, and returns a `storage` object with a bucket,
 * an endpoint and credentials in it. Everything about that says the feature
 * exists.
 *
 * `main.ts` builds a `LocalFileStore` either way:
 *
 *     const fileStore = new LocalFileStore(
 *       config.storage.backend === 'local' ? config.storage.path : '/var/lib/sone/files',
 *     );
 *
 * `store.ts` says so in its header, honestly — "the interface is deliberately
 * small so an S3 backend can implement it later". Later has not happened. What
 * has happened is that everything *around* the missing backend was built as
 * though it had.
 *
 * The chain, and it ends in lost attachments:
 *
 *   1. the operator sets `SONE_S3_*`, and the config accepts every one of them
 *   2. uploads go to `/var/lib/sone/files`, on the container's disk
 *   3. `backup.mjs` passes `filesPath: null` for a non-local backend, so the
 *      archive contains **no files** and the manifest records `fileStorage: 's3'`
 *   4. `docs/deployment.md` tells them "an instance with `SONE_S3_*` set has a
 *      database backup and a bucket, and the bucket needs a backup of its own"
 *   5. so they back up a bucket that has never had a byte written to it
 *   6. and on restore the archive says: "the source kept attachments in S3 …
 *      point this instance at that bucket"
 *
 * Every step is individually reasonable and the composition destroys the
 * attachments of anybody who followed the documentation.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ConfigError, loadConfig } from '../src/config.js';

/** The minimum an instance needs before storage is even reached. */
const BASE: Record<string, string> = {
  SONE_DATABASE_URL: 'postgres://localhost/sone',
  SONE_SECRET_KEY: 'a-test-instance-secret-key-of-sufficient-length',
};

const S3: Record<string, string> = {
  SONE_STORAGE_BACKEND: 's3',
  SONE_S3_ENDPOINT: 'https://s3.example.org',
  SONE_S3_BUCKET: 'sone-attachments',
  SONE_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  SONE_S3_SECRET_ACCESS_KEY: 'secret',
};

describe('the storage backend a build actually has', () => {
  test('local is the backend, and it works with a path or without one', () => {
    const byDefault = loadConfig({ ...BASE });
    assert.equal(byDefault.storage.backend, 'local');
    assert.equal(byDefault.storage.path, '/var/lib/sone/files');

    const chosen = loadConfig({ ...BASE, SONE_STORAGE_PATH: '/srv/sone/files' });
    assert.equal(chosen.storage.path, '/srv/sone/files');
  });

  test('s3 is refused, because this build does not have it', () => {
    /*
     * Refused at load rather than at the point the store is built.
     *
     * The config is where an operator's belief comes from: it demanded four S3
     * settings and accepted them, which is a stronger statement that the
     * feature exists than any documentation. Refusing here also stops
     * `backup.mjs` and `restore.mjs`, which call `loadConfig` too — the whole
     * family, in one place.
     */
    const err = (() => {
      try {
        loadConfig({ ...BASE, ...S3 });
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    assert.ok(err instanceof ConfigError, 'a configuration error, not a crash');
  });

  test('and the refusal says where the files already are', () => {
    /*
     * Whoever hits this has an instance that has been running: their uploads
     * are on local disk at the default path, and the fix is one variable with
     * nothing to move. A refusal that does not say so reads as "your files are
     * gone", which is the opposite of true and the moment somebody does
     * something drastic.
     */
    try {
      loadConfig({ ...BASE, ...S3 });
      assert.fail('expected a refusal');
    } catch (err) {
      const message = (err as Error).message;
      assert.match(message, /not implemented/i);
      assert.match(message, /\/var\/lib\/sone\/files/, 'where the files actually are');
      assert.match(message, /SONE_STORAGE_BACKEND=local/, 'and what to set');
      assert.ok(
        !/SONE_S3_SECRET_ACCESS_KEY=secret/.test(message),
        'and it does not print the credentials back',
      );
    }
  });

  test('an unknown backend is still refused the way it always was', () => {
    // The counterweight: `oneOf` already refused a typo, and that must keep
    // working rather than being replaced by the new message.
    assert.throws(
      () => loadConfig({ ...BASE, SONE_STORAGE_BACKEND: 'minio' }),
      ConfigError,
    );
  });
});
