/**
 * The ZIP writer (ADR-0044).
 *
 * Written by hand, so it is tested against the platform's own reader rather than
 * against my understanding of the format: the archive is unzipped by `unzip` if
 * it is on the machine, and its structure is checked either way. A format
 * implemented from a specification and verified only by its own author is a
 * format that works until somebody opens it in Finder.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { zip } from '../src/export/zip.js';

const at = new Date('2026-09-02T10:30:00Z');

test('an archive has one local header and one directory entry per file', () => {
  const archive = zip([
    { name: 'Notes/Draft.md', body: Buffer.from('# Draft\n\nSome words.\n'), at },
    { name: 'Notes/attachments/plan.txt', body: Buffer.from('plan'), at },
  ]);

  // Signatures, counted rather than assumed: two locals, two central headers,
  // one end record.
  const locals = [...archive.toString('latin1').matchAll(/PK\x03\x04/g)].length;
  const headers = [...archive.toString('latin1').matchAll(/PK\x01\x02/g)].length;
  assert.equal(locals, 2);
  assert.equal(headers, 2);
  assert.match(archive.toString('latin1'), /PK\x05\x06/);
});

test('a name is marked as UTF-8, or a reader guesses at its own code page', () => {
  // Without bit 11 a page called "Übersicht" arrives with a mangled name.
  const archive = zip([{ name: 'Übersicht.md', body: Buffer.from('x'), at }]);
  const flags = archive.readUInt16LE(6);
  assert.equal(flags & 0x0800, 0x0800);
  assert.ok(archive.includes(Buffer.from('Übersicht.md', 'utf8')));
});

test('a file that compression would enlarge is stored, not deflated', () => {
  // Small files and anything already compressed. Deflating them makes the
  // archive bigger, which is the opposite of the point.
  const archive = zip([{ name: 'a.txt', body: Buffer.from('x'), at }]);
  assert.equal(archive.readUInt16LE(8), 0, 'method 0: stored');
});

test('what comes out is what went in', () => {
  const body = Buffer.from('# Heading\n\n'.repeat(200));
  const archive = zip([{ name: 'long.md', body, at }]);

  // Read back by hand: past the local header and its name, inflate, compare.
  const nameLength = archive.readUInt16LE(26);
  const start = 30 + nameLength;
  const compressedSize = archive.readUInt32LE(18);
  const stored = archive.subarray(start, start + compressedSize);
  const method = archive.readUInt16LE(8);
  const out = method === 8 ? inflateRawSync(stored) : stored;
  assert.deepEqual(out, body);
});

test('the platform’s own unzip can read it', (t) => {
  // The assertion my own reading cannot make. Skipped rather than failed where
  // `unzip` is absent: a missing tool is not a broken archive.
  let available = true;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    available = false;
  }
  if (!available) {
    t.skip('unzip is not on this machine');
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'sone-zip-'));
  const path = join(dir, 'export.zip');
  writeFileSync(
    path,
    zip([
      { name: 'Ordner/Seite.md', body: Buffer.from('# Seite\n\nInhalt.\n'), at },
      { name: 'Ordner/attachments/bild.txt', body: Buffer.from('bytes'), at },
    ]),
  );

  execFileSync('unzip', ['-q', path, '-d', join(dir, 'out')]);
  assert.deepEqual(readdirSync(join(dir, 'out')), ['Ordner']);
  assert.equal(
    readFileSync(join(dir, 'out', 'Ordner', 'Seite.md'), 'utf8'),
    '# Seite\n\nInhalt.\n',
  );
  assert.equal(
    readFileSync(join(dir, 'out', 'Ordner', 'attachments', 'bild.txt'), 'utf8'),
    'bytes',
  );
});
