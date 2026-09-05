/**
 * Finding the text somebody typed inside a mail (ADR-0060).
 *
 * The reader is small because the record refuses things — plain text only, no
 * attachments, no HTML conversion. These tests are the shapes a reply actually
 * arrives in, and the ones it must decline rather than guess at.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressIn, deliveredAddresses, readMail } from '../src/mail/readMail.js';

const crlf = (...lines: string[]): string => lines.join('\r\n');

test('a plain reply typed on a phone', () => {
  const mail = readMail(
    crlf('From: Anna <anna@example.org>', 'Content-Type: text/plain', '', 'Ja, machen wir.'),
  );
  assert.equal(mail.text, 'Ja, machen wir.');
  assert.equal(mail.hadAttachments, false);
});

test('a multipart/alternative reply takes the plain half, not the HTML', () => {
  // The common desktop-client shape. Converting the HTML would put a guess at
  // somebody's markup into a page as a sentence they did not write.
  const mail = readMail(
    crlf(
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Kurz: ja.',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Kurz: <b>ja</b>.</p>',
      '--b1--',
    ),
  );
  assert.equal(mail.text, 'Kurz: ja.');
});

test('quoted-printable and base64 are decoded, with their umlauts intact', () => {
  const qp = readMail(
    crlf(
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Gr=C3=BC=C3=9Fe aus M=C3=BCnchen',
    ),
  );
  assert.equal(qp.text, 'Grüße aus München');

  const b64 = readMail(
    crlf(
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('Größe geprüft', 'utf8').toString('base64'),
    ),
  );
  assert.equal(b64.text, 'Größe geprüft');
});

test('a folded Content-Type header is read whole', () => {
  // A boundary is very often folded onto the next line, and reading only the
  // first would leave the parser splitting on an empty string.
  const mail = readMail(
    crlf(
      'Content-Type: multipart/mixed;',
      '\tboundary="deadbeef"',
      '',
      '--deadbeef',
      'Content-Type: text/plain',
      '',
      'Text trotz Faltung.',
      '--deadbeef--',
    ),
  );
  assert.equal(mail.text, 'Text trotz Faltung.');
});

test('an attachment is counted, not kept', () => {
  // Silence about a dropped file is worse than the drop, so the reply says so.
  const mail = readMail(
    crlf(
      'Content-Type: multipart/mixed; boundary="m"',
      '',
      '--m',
      'Content-Type: text/plain',
      '',
      'Siehe Anhang.',
      '--m',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="vertrag.pdf"',
      '',
      'JVBERi0=',
      '--m--',
    ),
  );
  assert.equal(mail.text, 'Siehe Anhang.');
  assert.equal(mail.hadAttachments, true);
});

test('an HTML-only mail yields no text rather than a guess', () => {
  const mail = readMail(crlf('Content-Type: text/html', '', '<p>Ja</p>'));
  assert.equal(mail.text, null);
});

test('Delivered-To is read before To', () => {
  /*
   * The whole security of this feature rests on reading the right address: the
   * token lives in the sub-address the *mailbox* saw, and `To` may have been
   * rewritten by a list, a forward or somebody's filter (ADR-0060).
   */
  const mail = readMail(
    crlf(
      'Delivered-To: sone+abc.def@example.org',
      'To: team@example.org',
      'Content-Type: text/plain',
      '',
      'Hallo',
    ),
  );
  const addresses = deliveredAddresses(mail.headers);
  assert.equal(addresses[0], 'sone+abc.def@example.org');
  assert.ok(addresses.includes('team@example.org'), 'and the others are still there');
});

test('a second From does not overwrite the first', () => {
  // Not that From is trusted — it is decoration here — but a header that can be
  // supplied twice should resolve the same way every time.
  const mail = readMail(
    crlf('From: echt@example.org', 'From: gefaelscht@example.org', '', 'Text'),
  );
  assert.equal(mail.headers.get('from'), 'echt@example.org');
});

test('an unencoded utf-8 body keeps its umlauts', () => {
  /*
   * The 8-bit case, which is what a phone sends and what nothing here tested.
   *
   * The mail arrives over a socket read as latin1 — one byte, one character —
   * so a utf-8 body reaches the reader as the *bytes* of that text. Reading
   * those back as utf8 re-encodes everything above 127 and doubles it: `Grüße`
   * became `GrÃ¼ÃŸe` in the page, for as long as replying by mail existed
   * (ADR-0078).
   *
   * Base64 and quoted-printable were always right, and both umlaut tests above
   * are written for those — which is exactly why this went unseen: those two
   * encodings exist *because* a mail has non-ASCII in it, so that is where
   * anyone thinks to put a charset test.
   */
  const bytes = Buffer.from(
    crlf('From: anna@example.org', 'Content-Type: text/plain; charset=utf-8', '', 'Grüße, schön!'),
    'utf8',
  ).toString('latin1');

  assert.equal(readMail(bytes).text, 'Grüße, schön!');
});

test('a latin-1 body is still read as latin-1', () => {
  // The other side of the same change: an older client that says iso-8859-1
  // means one byte per character, and must not be decoded as utf-8.
  const bytes = Buffer.from(
    crlf('From: anna@example.org', 'Content-Type: text/plain; charset=iso-8859-1', '', 'Grüße'),
    'latin1',
  ).toString('latin1');

  assert.equal(readMail(bytes).text, 'Grüße');
});

test('an address is taken out of a header that carries a name', () => {
  /*
   * A refusal is the one mail SONE sends to an address it did not choose, and
   * the whole header used to be handed to the relay — producing
   * `RCPT TO:<Anna Beispiel <anna@example.org>>`, which every relay rejects
   * (ADR-0078).
   */
  assert.equal(addressIn('anna@example.org'), 'anna@example.org');
  assert.equal(addressIn('Anna Beispiel <anna@example.org>'), 'anna@example.org');
  assert.equal(addressIn('"Beispiel, Anna" <anna@example.org>'), 'anna@example.org');
  assert.equal(addressIn('  =?utf-8?q?Gr=C3=BC=C3=9Fe?= <anna@example.org>  '), 'anna@example.org');
});

test('an address that cannot be written to is null, not a guess', () => {
  // Somebody who cannot be written to is a thing to record, not to approximate.
  assert.equal(addressIn(null), null);
  assert.equal(addressIn(''), null);
  assert.equal(addressIn('Anonymous'), null);
  assert.equal(addressIn('undisclosed-recipients:;'), null);
  // A newline in a recipient is a header injection waiting for a relay.
  assert.equal(addressIn('anna@example.org\r\nBcc: alle@example.org'), null);
});
