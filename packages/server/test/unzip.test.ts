/**
 * Reading a ZIP archive (ADR-0044).
 *
 * The round trip through our own writer is the test that matters most — an
 * export nobody can import back is not an export — and the rest are about a
 * parser of untrusted input refusing rather than guessing.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { zip } from '../src/export/zip.js';
import { ArchiveError, MAX_ENTRIES, unzip } from '../src/import/unzip.js';

const at = new Date('2026-09-02T10:30:00Z');

test('what our writer wrote, our reader reads', () => {
  const files = [
    { name: 'Ordner/index.md', body: Buffer.from('# Ordner\n'), at },
    { name: 'Ordner/Übersicht.md', body: Buffer.from('# Übersicht\n\nInhalt.\n'), at },
    { name: 'attachments/f-1', body: Buffer.from('x'.repeat(5000)), at },
  ];

  const entries = unzip(zip(files));
  assert.deepEqual(
    entries.map((entry) => entry.name),
    files.map((file) => file.name),
    'every name, umlaut included',
  );
  assert.deepEqual(entries[1]?.body, files[1]?.body);
  // The third is large enough to have been deflated, which is the path that
  // would break silently if the reader used the directory's compressed size
  // wrongly.
  assert.deepEqual(entries[2]?.body, files[2]?.body);
});

test('a directory entry carries no page', () => {
  // Structure comes from the paths; an empty directory has nothing in it.
  const archive = zip([
    { name: 'Folder/', body: Buffer.alloc(0), at },
    { name: 'Folder/Page.md', body: Buffer.from('# Page\n'), at },
  ]);
  assert.deepEqual(
    unzip(archive).map((entry) => entry.name),
    ['Folder/Page.md'],
  );
});

test('a name that escapes its directory is refused', () => {
  // The oldest archive attack there is. This import never writes to a file
  // system, and that is not a reason to accept it: the names become titles and
  // folders, and a page called `..` is its own kind of mess.
  for (const name of ['../secret.md', '/etc/passwd', 'a/../../b.md']) {
    const archive = zip([{ name, body: Buffer.from('x'), at }]);
    assert.throws(
      () => unzip(archive),
      (error: unknown) => error instanceof ArchiveError && error.code === 'unsafe_name',
      name,
    );
  }
});

test('something that is not an archive is refused, not guessed at', () => {
  assert.throws(
    () => unzip(Buffer.from('This is a text file, not a zip.')),
    (error: unknown) => error instanceof ArchiveError && error.code === 'not_an_archive',
  );
  assert.throws(
    () => unzip(Buffer.alloc(4)),
    (error: unknown) => error instanceof ArchiveError && error.code === 'not_an_archive',
  );
});

test('an archive written by something else reads too', (t) => {
  // Our own writer agreeing with our own reader proves less than it looks:
  // both could share a misunderstanding. This checks against `zip` if the
  // machine has it, and skips otherwise.
  let available = true;
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
  } catch {
    available = false;
  }
  if (!available) {
    t.skip('zip is not on this machine');
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'sone-unzip-'));
  writeFileSync(join(dir, 'Seite.md'), '# Seite\n\nInhalt.\n');
  execFileSync('zip', ['-q', 'archive.zip', 'Seite.md'], { cwd: dir });

  const entries = unzip(readFileSync(join(dir, 'archive.zip')));
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['Seite.md'],
  );
  assert.equal(entries[0]?.body.toString('utf8'), '# Seite\n\nInhalt.\n');
});

test('a Zip64 archive is named as such, not as too many entries', () => {
  /*
   * The refusal that sent somebody looking for files to delete.
   *
   * The count in the end record is sixteen bits; an archive that needs more —
   * or a writer that chose Zip64 anyway — sets it to 0xFFFF, which is larger
   * than any sane limit. The old code compared that to MAX_ENTRIES and said
   * "too many entries" about an archive that might hold three files.
   */
  const archive = Buffer.alloc(22);
  archive.writeUInt32LE(0x06054b50, 0);
  archive.writeUInt16LE(0xffff, 10);

  const failure = (): unknown => unzip(archive);
  assert.throws(failure, (error: unknown) => {
    assert.ok(error instanceof ArchiveError);
    assert.equal(error.code, 'zip64_unsupported');
    return true;
  });
});

test('too many entries says how many, and how many are allowed', () => {
  // "too_many_entries" alone is a dead end: somebody cannot tell whether they
  // are over by one file or by four thousand.
  const archive = Buffer.alloc(22);
  archive.writeUInt32LE(0x06054b50, 0);
  archive.writeUInt16LE(MAX_ENTRIES + 1, 10);

  assert.throws(
    () => unzip(archive),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError);
      assert.equal(error.code, 'too_many_entries');
      assert.match(error.message, new RegExp(String(MAX_ENTRIES + 1)));
      assert.match(error.message, new RegExp(String(MAX_ENTRIES)));
      return true;
    },
  );
});

test('an entry that lies about its uncompressed size is refused (ADR-0184)', () => {
  // A zip bomb declares a small (or zero) uncompressed size in the directory
  // and inflates to far more. The size limit used to sum the *declared* sizes,
  // so declaring zero slipped past it. Build an honest archive, then patch its
  // central-directory size to zero: the reader must reject it on the actual
  // output, not accept a megabyte because the directory claimed nothing.
  const archive = zip([{ name: 'bomb.md', body: Buffer.alloc(1_000_000), at }]);

  // Walk the central directory (signature 0x02014b50) and zero each entry's
  // uncompressed-size field (offset +24).
  for (let i = 0; i + 4 <= archive.length; i += 1) {
    if (archive.readUInt32LE(i) === 0x0201_4b50) {
      archive.writeUInt32LE(0, i + 24);
    }
  }

  assert.throws(
    () => unzip(archive),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError);
      // Either verdict is a refusal on the real bytes rather than the declared
      // ones: "lies about its size" when the inflate finishes under the cap,
      // "too_large" when it would run past it.
      assert.ok(error.code === 'not_an_archive' || error.code === 'too_large', error.code);
      return true;
    },
  );
});
