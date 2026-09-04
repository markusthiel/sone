/**
 * Packing a few files into an archive (import).
 *
 * Tested here rather than in core, deliberately: what matters is that **the
 * server's own unzip reads what the browser's pack writes**. A test in core
 * could only check the writer against itself, and the failure this rules out is
 * exactly the one where both sides are self-consistent and disagree with each
 * other.
 *
 * The second test unpacks it with the `unzip` binary, so a third party agrees
 * too.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { MAX_STORED_ENTRIES, PackError, packStored } from '@sone/core';

import { unzip } from '../src/import/unzip.js';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

test('what the browser packs, the server unpacks', () => {
  const archive = packStored([
    { name: 'Eine Notiz.md', body: text('# Eine Notiz\n\nMit Text.\n') },
    { name: 'Ordner/Zwei.md', body: text('# Zwei\n') },
    // A name with an umlaut, because the flag says the names are UTF-8 and
    // that claim has to be true.
    { name: 'Übergabe.md', body: text('# Übergabe\n') },
  ]);

  const entries = unzip(Buffer.from(archive));
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['Eine Notiz.md', 'Ordner/Zwei.md', 'Übergabe.md'],
  );
  assert.match(entries[0]!.body.toString('utf8'), /# Eine Notiz/);
  assert.match(entries[2]!.body.toString('utf8'), /Übergabe/);
});

test('and so does a real unzip', () => {
  /*
   * The condition on writing an archive format by hand, the same one the IMAP
   * client had: it is checked against something that is not my own reader.
   */
  const archive = packStored([{ name: 'Notiz.md', body: text('# Notiz\n') }]);
  const dir = mkdtempSync(join(tmpdir(), 'sone-pack-'));
  const path = join(dir, 'archive.zip');
  writeFileSync(path, archive);

  const listing = execFileSync('unzip', ['-l', path], { encoding: 'utf8' });
  assert.match(listing, /Notiz\.md/);

  execFileSync('unzip', ['-o', '-q', path, '-d', dir]);
  assert.equal(readFileSync(join(dir, 'Notiz.md'), 'utf8'), '# Notiz\n');
});

test('an empty file and an empty archive both come through', () => {
  // Both are edge cases a CRC and a length calculation get wrong in different
  // ways, and both are things somebody will actually select.
  const withEmpty = unzip(Buffer.from(packStored([{ name: 'Leer.md', body: text('') }])));
  assert.equal(withEmpty.length, 1);
  assert.equal(withEmpty[0]!.body.length, 0);

  const nothing = packStored([]);
  assert.equal(unzip(Buffer.from(nothing)).length, 0);
});

test('more files than it packs is refused before anything is written', () => {
  const many = Array.from({ length: MAX_STORED_ENTRIES + 1 }, (_, at) => ({
    name: `Notiz ${at}.md`,
    body: text('#'),
  }));
  assert.throws(
    () => packStored(many),
    (error: unknown) => {
      assert.ok(error instanceof PackError);
      assert.equal(error.code, 'too_many_files');
      return true;
    },
  );
});
