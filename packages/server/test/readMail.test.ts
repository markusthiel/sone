/**
 * Finding the text somebody typed inside a mail (ADR-0060).
 *
 * The reader is small because the record refuses things — plain text only, no
 * attachments, no HTML conversion. These tests are the shapes a reply actually
 * arrives in, and the ones it must decline rather than guess at.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deliveredAddresses, readMail } from '../src/mail/readMail.js';

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
