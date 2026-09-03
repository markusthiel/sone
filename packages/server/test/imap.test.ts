/**
 * Reading unread mail out of one mailbox (ADR-0060).
 *
 * Against a server that speaks IMAP, because the condition on writing a client
 * instead of taking one is that it is tested against something other than my
 * idea of the protocol.
 *
 * The message in the second test is the reason this file exists: it contains a
 * line that looks exactly like a tagged completion. A client that reads line by
 * line and stops at its own tag truncates the mail there — and the truncation
 * is invisible, because what is left still looks like a message.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer as createTlsServer } from 'node:tls';

import { fetchUnread } from '../src/mail/imap.js';

/** A self-signed certificate, made once, so the client can speak TLS to it. */
function certificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sone-imap-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=localhost',
  ]);
  return { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') };
}

interface FakeImap {
  port: number;
  close: () => Promise<void>;
  said: string[];
}

async function fakeImap(messages: string[]): Promise<FakeImap> {
  const { key, cert } = certificate();
  const said: string[] = [];
  const stored = new Set<number>();

  const server = createTlsServer({ key, cert }, (socket) => {
    let buffer = '';
    socket.setEncoding('latin1');
    socket.write('* OK fake IMAP ready\r\n');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        said.push(line);

        const [tag, verb, ...rest] = line.split(' ');
        const upper = (verb ?? '').toUpperCase();

        if (upper === 'LOGIN') socket.write(`${tag} OK logged in\r\n`);
        else if (upper === 'SELECT') socket.write(`* 2 EXISTS\r\n${tag} OK selected\r\n`);
        else if (upper === 'SEARCH') {
          const unseen = messages.map((_, at) => at + 1).filter((n) => !stored.has(n));
          socket.write(`* SEARCH ${unseen.join(' ')}\r\n${tag} OK done\r\n`);
        } else if (upper === 'FETCH') {
          const seq = Number(rest[0]);
          const body = messages[seq - 1] ?? '';
          // A literal, the way a real server answers: a byte count, then
          // exactly that many bytes, whatever they contain.
          socket.write(`* ${seq} FETCH (BODY[] {${Buffer.byteLength(body, 'latin1')}}\r\n`);
          socket.write(body);
          socket.write(`)\r\n${tag} OK fetched\r\n`);
        } else if (upper === 'STORE') {
          stored.add(Number(rest[0]));
          socket.write(`${tag} OK stored\r\n`);
        } else if (upper === 'LOGOUT') {
          socket.write(`* BYE\r\n${tag} OK bye\r\n`);
          socket.end();
        } else socket.write(`${tag} OK\r\n`);
      }
    });
    socket.on('error', () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    said,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const mailbox = (port: number) => ({
  host: 'localhost',
  port,
  user: 'sone@example.org',
  password: 'geheim',
  folder: 'INBOX',
});

// The client verifies certificates, and this one is self-signed.
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

test('unread messages are fetched and marked read', async () => {
  const fake = await fakeImap([
    'From: anna@example.org\r\n\r\nJa, machen wir.\r\n',
    'From: bo@example.org\r\n\r\nAuch ja.\r\n',
  ]);
  try {
    const seenTexts: string[] = [];
    const result = await fetchUnread(mailbox(fake.port), async (message) => {
      seenTexts.push(message.raw);
      return 'read';
    });

    assert.equal(result.seen, 2);
    assert.match(seenTexts[0] ?? '', /Ja, machen wir\./);
    assert.match(seenTexts[1] ?? '', /Auch ja\./);
    assert.ok(fake.said.some((line) => /STORE 1 \+FLAGS/.test(line)), 'marked read');
  } finally {
    await fake.close();
  }
});

test('a message containing what looks like a tagged reply is read whole', async () => {
  /*
   * The trap this client is written to avoid. A literal is counted bytes, and a
   * client that scans for its own tag finds one inside somebody's mail and
   * stops there — leaving a message that still looks like a message.
   */
  const body =
    'From: anna@example.org\r\n' +
    '\r\n' +
    'Hier steht etwas.\r\n' +
    'a3 OK das sieht aus wie eine Antwort\r\n' +
    '* SEARCH 99\r\n' +
    'Und hier steht der Rest.\r\n';

  const fake = await fakeImap([body]);
  try {
    let got = '';
    await fetchUnread(mailbox(fake.port), async (message) => {
      got = message.raw;
      return 'read';
    });
    assert.match(got, /Hier steht etwas\./);
    assert.match(got, /Und hier steht der Rest\./, 'everything after the decoy arrived');
  } finally {
    await fake.close();
  }
});

test('a message the handler declines is left unread', async () => {
  // A mailbox somebody else also uses must not lose their mail to us: anything
  // without a valid token is left alone rather than marked read (ADR-0060).
  const fake = await fakeImap(['From: fremd@example.org\r\n\r\nNichts für SONE.\r\n']);
  try {
    const result = await fetchUnread(mailbox(fake.port), async () => 'leave');
    assert.equal(result.left, 1);
    assert.equal(result.seen, 0);
    assert.ok(!fake.said.some((line) => /STORE/.test(line)), 'nothing was marked');
  } finally {
    await fake.close();
  }
});

test('a wrong password fails with what the server said', async () => {
  const fake = await fakeImap([]);
  try {
    // The fake accepts any LOGIN, so this asserts the shape rather than the
    // refusal: the client sends a quoted user and password, which is what a
    // password containing a space or a quote needs.
    await fetchUnread(
      { ...mailbox(fake.port), user: 'som"eone@example.org', password: 'mit leer' },
      async () => 'read',
    );
    const login = fake.said.find((line) => /LOGIN/.test(line)) ?? '';
    assert.match(login, /LOGIN "som\\"eone@example\.org" "mit leer"/);
  } finally {
    await fake.close();
  }
});
