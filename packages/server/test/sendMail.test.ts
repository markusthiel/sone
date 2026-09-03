/**
 * Handing a mail to a relay, against something that speaks back (ADR-0058).
 *
 * The client is written rather than depended on, and the condition on that trade
 * is that it is tested against a server rather than against my idea of one. This
 * is that server: it talks SMTP, records what it was told, and behaves in the
 * ways that break hand-written clients — a multi-line EHLO reply, a body
 * containing a lone dot, a subject with a newline in it.
 *
 * These passed first time. That is worth saying plainly rather than dressing
 * the tests up as bug reports: they are here so the claims in the client's
 * comments are checked by something other than the comments.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { test } from 'node:test';

import { sendMail } from '../src/mail/send.js';

interface FakeRelay {
  server: Server;
  port: number;
  /** Everything the client said, in order. */
  said: string[];
  /** The message body between DATA and the closing dot. */
  data: string;
  close: () => Promise<void>;
}

async function fakeRelay(options: { multilineEhlo?: boolean } = {}): Promise<FakeRelay> {
  const state: { said: string[]; data: string } = { said: [], data: '' };

  const server = createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.write('220 fake ESMTP\r\n');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
            continue;
          }
          // Undo dot-stuffing, the way a real relay does: this is how the test
          // can tell a truncated body from an intact one.
          state.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }

        state.said.push(line);
        const verb = line.split(' ')[0]?.toUpperCase() ?? '';
        if (verb === 'EHLO') {
          // A real relay answers with its capabilities across several lines,
          // each continued with a hyphen. My first client read one line and
          // hung waiting for a reply that had already arrived.
          socket.write(
            options.multilineEhlo === false
              ? '250 fake\r\n'
              : '250-fake greets you\r\n250-SIZE 10240000\r\n250-8BITMIME\r\n250 AUTH PLAIN LOGIN\r\n',
          );
        } else if (verb === 'MAIL' || verb === 'RCPT') {
          socket.write('250 ok\r\n');
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
    socket.on('error', () => {
      // A client that hangs up mid-conversation is not this test's subject.
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    server,
    port,
    get said() {
      return state.said;
    },
    get data() {
      return state.data;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

const relay = (port: number) => ({
  host: '127.0.0.1',
  port,
  user: '',
  password: '',
  from: 'sone@example.org',
  security: 'none' as const,
});

test('a mail goes through the conversation a relay expects', async () => {
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'anna@example.org',
      subject: 'Anna — Q3 Planung',
      body: 'Bo hat dich erwähnt.',
    });

    assert.deepEqual(
      fake.said.map((line) => line.split(' ')[0]),
      ['EHLO', 'MAIL', 'RCPT', 'DATA', 'QUIT'],
    );
    assert.match(fake.data, /Subject: Anna — Q3 Planung/);
    assert.match(fake.data, /Bo hat dich erwähnt\./);
  } finally {
    await fake.close();
  }
});

test('a multi-line EHLO reply is read to its end', async () => {
  // A reply is finished only when a line's fourth character is a space. A
  // client that reads one line and moves on works against a relay answering in
  // one line and hangs against every real one, so the fake answers in four.
  const fake = await fakeRelay({ multilineEhlo: true });
  try {
    await sendMail(relay(fake.port), { to: 'a@example.org', subject: 'x', body: 'y' });
    assert.ok(fake.said.includes('QUIT'), 'the conversation reached the end');
  } finally {
    await fake.close();
  }
});

test('a lone dot in the body does not truncate the mail', async () => {
  // The classic one: a line that is a single dot ends the message, and a body
  // is text somebody wrote, so it can contain one.
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'a@example.org',
      subject: 'x',
      body: 'erste Zeile\n.\nletzte Zeile',
    });
    assert.match(fake.data, /erste Zeile/);
    assert.match(fake.data, /letzte Zeile/, 'everything after the dot arrived');
  } finally {
    await fake.close();
  }
});

test('a newline in the subject cannot add a header', async () => {
  // A page title reaches the subject line, and a page title is text somebody
  // typed. Without this, everything after a newline becomes a header — a Bcc,
  // for instance.
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'a@example.org',
      subject: 'harmlos\r\nBcc: elsewhere@example.org',
      body: 'y',
    });
    assert.doesNotMatch(fake.data, /^Bcc:/m);
  } finally {
    await fake.close();
  }
});

test('a password is refused over an unencrypted connection', async () => {
  // Worse than no mail: a credential in the clear, to a relay somebody
  // mistyped the settings for.
  const fake = await fakeRelay();
  try {
    await assert.rejects(
      sendMail(
        { ...relay(fake.port), user: 'someone', password: 'secret' },
        { to: 'a@example.org', subject: 'x', body: 'y' },
      ),
      /unencrypted/,
    );
    assert.ok(!fake.said.some((line) => line.includes('secret')), 'nothing was sent');
  } finally {
    await fake.close();
  }
});
