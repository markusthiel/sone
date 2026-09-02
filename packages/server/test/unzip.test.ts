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
import { ArchiveError, unzip } from '../src/import/unzip.js';

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
