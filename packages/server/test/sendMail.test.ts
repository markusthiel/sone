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

import { createConnection } from 'node:net';

import { offeredAuth, sendMail } from '../src/mail/send.js';

interface FakeRelay {
  server: Server;
  port: number;
  /** Everything the client said, in order. */
  said: string[];
  /** The message body between DATA and the closing dot. */
  data: string;
  close: () => Promise<void>;
}

async function fakeRelay(
  options: {
    multilineEhlo?: boolean;
    /** The AUTH line this relay advertises; `null` for a relay that says nothing. */
    auth?: string | null;
    /** Rejects any mechanism outside its own AUTH line, the way a real one does. */
    accepts?: { user: string; password: string };
  } = {},
): Promise<FakeRelay> {
  const state: { said: string[]; data: string } = { said: [], data: '' };
  const authLine = options.auth === undefined ? 'AUTH PLAIN LOGIN' : options.auth;
  const mechanisms = authLine ? authLine.replace(/^AUTH[ =]/, '').split(' ') : ['PLAIN', 'LOGIN'];
  const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

  const server = createServer((socket) => {
    let inData = false;
    let buffer = '';
    // Where an AUTH LOGIN stands: waiting for the user, then the password.
    let login: 'user' | 'password' | null = null;
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

        if (login !== null) {
          // The two challenges of AUTH LOGIN, answered one line at a time.
          if (login === 'user') {
            login = line === b64(options.accepts?.user ?? '') ? 'password' : null;
            socket.write(login ? `334 ${b64('Password:')}\r\n` : '535 5.7.8 bad user\r\n');
          } else {
            login = null;
            socket.write(
              line === b64(options.accepts?.password ?? '')
                ? '235 2.7.0 Authentication successful\r\n'
                : '535 5.7.8 Authentication credentials invalid\r\n',
            );
          }
          continue;
        }

        const verb = line.split(' ')[0]?.toUpperCase() ?? '';
        if (verb === 'EHLO') {
          // A real relay answers with its capabilities across several lines,
          // each continued with a hyphen. My first client read one line and
          // hung waiting for a reply that had already arrived.
          socket.write(
            options.multilineEhlo === false
              ? '250 fake\r\n'
              : `250-fake greets you\r\n250-SIZE 10240000\r\n250-8BITMIME\r\n` +
                  (authLine ? `250-${authLine}\r\n` : '') +
                  `250 SMTPUTF8\r\n`,
          );
        } else if (verb === 'AUTH') {
          const mechanism = line.split(' ')[1]?.toUpperCase() ?? '';
          if (!mechanisms.includes(mechanism)) {
            // Word for word what Exchange Online answers to `AUTH PLAIN`.
            socket.write('504 5.7.4 Unrecognized authentication type\r\n');
          } else if (mechanism === 'LOGIN') {
            login = 'user';
            socket.write(`334 ${b64('Username:')}\r\n`);
          } else {
            const [, user, password] = Buffer.from(line.split(' ')[2] ?? '', 'base64')
              .toString('utf8')
              .split('\0');
            socket.write(
              user === options.accepts?.user && password === options.accepts?.password
                ? '235 2.7.0 Authentication successful\r\n'
                : '535 5.7.8 Authentication credentials invalid\r\n',
            );
          }
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

/**
 * A connection the client believes is TLS, to a fake that speaks none.
 *
 * Authentication only ever happens over an encrypted connection, so without
 * this the fake never heard the AUTH step — and the AUTH step was the one that
 * was wrong. The handshake is not what these tests are about; the conversation
 * after it is.
 */
const pretendTls = (port: number) =>
  new Promise<import('node:net').Socket>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });

const withPassword = (port: number) => ({
  ...relay(port),
  user: 'info@example.org',
  password: 'sixteen-chars-pw',
  security: 'tls' as const,
});
const message = { to: 'a@example.org', subject: 'x', body: 'y' };

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

// --- which way the password goes -------------------------------------------

test('a relay offering PLAIN gets AUTH PLAIN, in one round trip', async () => {
  const fake = await fakeRelay({
    auth: 'AUTH PLAIN LOGIN',
    accepts: { user: 'info@example.org', password: 'sixteen-chars-pw' },
  });
  try {
    const r = withPassword(fake.port);
    await sendMail(r, message, new Date(), () => pretendTls(r.port));
    const auth = fake.said.filter((line) => line.startsWith('AUTH'));
    assert.equal(auth.length, 1);
    assert.match(auth[0]!, /^AUTH PLAIN /);
    assert.ok(fake.said.includes('QUIT'), 'and the mail went through');
  } finally {
    await fake.close();
  }
});

test('a relay offering only LOGIN gets AUTH LOGIN, user and password each on their own line', async () => {
  /*
   * Exchange Online, after STARTTLS: `250-AUTH LOGIN XOAUTH2`. The client sent
   * `AUTH PLAIN` regardless — it never read the capability lines, the session
   * dropped them — and got `504 5.7.4 Unrecognized authentication type`, which
   * an operator reads as a wrong password. The password was right.
   */
  const fake = await fakeRelay({
    auth: 'AUTH LOGIN XOAUTH2',
    accepts: { user: 'info@example.org', password: 'sixteen-chars-pw' },
  });
  try {
    const r = withPassword(fake.port);
    await sendMail(r, message, new Date(), () => pretendTls(r.port));
    const at = fake.said.indexOf('AUTH LOGIN');
    assert.notEqual(at, -1, 'LOGIN was chosen');
    assert.ok(!fake.said.some((line) => line.startsWith('AUTH PLAIN')), 'PLAIN was not tried');
    assert.equal(fake.said[at + 1], Buffer.from('info@example.org').toString('base64'));
    assert.equal(fake.said[at + 2], Buffer.from('sixteen-chars-pw').toString('base64'));
    assert.ok(fake.said.includes('QUIT'), 'and the mail went through');
  } finally {
    await fake.close();
  }
});

test('a relay offering neither says so, naming what it does offer', async () => {
  // The tenant that has moved to OAuth only. The error should contain the word
  // an operator can act on, not a 504 to search for.
  const fake = await fakeRelay({ auth: 'AUTH XOAUTH2' });
  try {
    const r = withPassword(fake.port);
    await assert.rejects(
      sendMail(r, message, new Date(), () => pretendTls(r.port)),
      /PLAIN, LOGIN.*offers: XOAUTH2/,
    );
    assert.ok(!fake.said.some((line) => line.startsWith('AUTH')), 'nothing was attempted');
  } finally {
    await fake.close();
  }
});

test('a relay that advertises nothing is tried with PLAIN, as before', async () => {
  // Advertising the extension is optional; a relay that keeps quiet is not one
  // that refuses, and this is how every relay was treated before any of this
  // was read.
  const fake = await fakeRelay({
    auth: null,
    accepts: { user: 'info@example.org', password: 'sixteen-chars-pw' },
  });
  try {
    const r = withPassword(fake.port);
    await sendMail(r, message, new Date(), () => pretendTls(r.port));
    assert.ok(fake.said.some((line) => line.startsWith('AUTH PLAIN')));
  } finally {
    await fake.close();
  }
});

test('a wrong password under LOGIN fails without the password in the error', async () => {
  // The failing line *is* the password, base64 — and the error lands on an
  // administrator's screen and in the log.
  const fake = await fakeRelay({
    auth: 'AUTH LOGIN',
    accepts: { user: 'info@example.org', password: 'something-else' },
  });
  try {
    const r = withPassword(fake.port);
    await assert.rejects(
      sendMail(r, message, new Date(), () => pretendTls(r.port)),
      (err: Error) => {
        assert.match(err.message, /^AUTH: 535/);
        assert.doesNotMatch(err.message, new RegExp(Buffer.from(r.password).toString('base64')));
        return true;
      },
    );
  } finally {
    await fake.close();
  }
});

test('the AUTH line is read whether it says AUTH or AUTH=', () => {
  assert.deepEqual(offeredAuth(['fake greets you', 'SIZE 1', 'AUTH LOGIN XOAUTH2']), [
    'LOGIN',
    'XOAUTH2',
  ]);
  assert.deepEqual(offeredAuth(['AUTH=PLAIN LOGIN']), ['PLAIN', 'LOGIN']);
  assert.equal(offeredAuth(['fake', 'STARTTLS']), null);
  // `AUTHENTICATE`-style lines or a bare `AUTH` are not a mechanism list.
  assert.equal(offeredAuth(['AUTHORITY x']), null);
});

test('a reply address becomes a Reply-To, and changes what the mail admits to being', async () => {
  /*
   * Both headers tell an out-of-office responder not to answer, which is the
   * point: a holiday autoresponder replying to a notification would arrive back
   * here as a comment. But announcing a mail as auto-*generated* while asking
   * for a reply would be telling two things at once (ADR-0060).
   */
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'anna@example.org',
      subject: 's',
      body: 'b',
      replyTo: 'sone+token@example.org',
    });
    assert.match(fake.data, /Reply-To: sone\+token@example\.org/);
    assert.match(fake.data, /Auto-Submitted: auto-replied/);
  } finally {
    await fake.close();
  }

  const plain = await fakeRelay();
  try {
    await sendMail(relay(plain.port), { to: 'a@example.org', subject: 's', body: 'b' });
    assert.doesNotMatch(plain.data, /Reply-To:/);
    assert.match(plain.data, /Auto-Submitted: auto-generated/);
  } finally {
    await plain.close();
  }
});

test('the unsubscribe header ADR-0058 promised is actually sent', async () => {
  /*
   * The record says "a `List-Unsubscribe` header is included for mail clients
   * that offer the button". It was not: the comment describing it survived in
   * `send.ts` and the line under it became `Auto-Submitted`, so the whole
   * repository held the string once — in the record (ADR-0081).
   *
   * A URL only, and no `List-Unsubscribe-Post`: the one-click form lets anybody
   * who can send a request unsubscribe somebody else, and the page it points at
   * is behind a sign-in for exactly that reason.
   */
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'anna@example.org',
      subject: 's',
      body: 'b',
      unsubscribeUrl: 'https://sone.example/settings/notifications',
    });
    assert.match(
      fake.data,
      /List-Unsubscribe: <https:\/\/sone\.example\/settings\/notifications>/,
    );
    assert.doesNotMatch(fake.data, /List-Unsubscribe-Post/);
  } finally {
    await fake.close();
  }

  const without = await fakeRelay();
  try {
    await sendMail(relay(without.port), { to: 'a@example.org', subject: 's', body: 'b' });
    assert.doesNotMatch(without.data, /List-Unsubscribe/);
  } finally {
    await without.close();
  }
});

// --- the html part (ADR-0121) ------------------------------------------------

test('a mail with an html part is multipart, and the text comes first', async () => {
  /*
   * `multipart/alternative` means "the same thing, twice" — and the order is
   * the contract: a client shows the **last** part it can display, so the text
   * goes first and the HTML after it. Reversed, every graphical client would
   * show the plain text.
   *
   * The text part is not decoration. A text-only client, a screen reader set to
   * prefer it, and a mailing list that strips HTML all get the same letter.
   */
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'a@example.org',
      subject: 'x',
      body: 'Anna hat dich erwähnt.',
      html: '<p>Anna hat dich erwähnt.</p>',
    });

    const boundary = /boundary="([^"]+)"/.exec(fake.data)?.[1];
    assert.ok(boundary, 'a boundary is declared');
    assert.match(fake.data, /Content-Type: multipart\/alternative/);
    assert.ok(
      fake.data.indexOf('text/plain') < fake.data.indexOf('text/html'),
      'text first, html last — a client shows the last part it understands',
    );
    assert.match(fake.data, new RegExp(`--${boundary}--`), 'and the last boundary is closed');
  } finally {
    await fake.close();
  }
});

test('the boundary is not a constant a body could contain', async () => {
  /*
   * A body containing the boundary string would end the part early, and the
   * rest of somebody's mail would arrive as MIME wreckage. Random per message
   * is the answer; the property worth asserting is that it is not fixed.
   */
  const first = await fakeRelay();
  const second = await fakeRelay();
  try {
    const one = { to: 'a@example.org', subject: 'x', body: 'y', html: '<p>y</p>' };
    await sendMail(relay(first.port), one);
    await sendMail(relay(second.port), one);

    const a = /boundary="([^"]+)"/.exec(first.data)?.[1];
    const b = /boundary="([^"]+)"/.exec(second.data)?.[1];
    assert.ok(a && b);
    assert.notEqual(a, b, 'a fixed boundary is one a body can contain');
  } finally {
    await first.close();
    await second.close();
  }
});

test('a mail with no html part is a plain one, as before', async () => {
  // The counterweight. Most mails this server sends have no HTML, and they must
  // not grow MIME machinery for nothing.
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), { to: 'a@example.org', subject: 'x', body: 'y' });

    assert.match(fake.data, /Content-Type: text\/plain; charset=utf-8/);
    assert.doesNotMatch(fake.data, /multipart/);
  } finally {
    await fake.close();
  }
});

test('a picture travels inside the message, wrapped around the two renderings', async () => {
  /*
   * The nesting is the decision (ADR-0132). `multipart/related` holds the
   * message *and the pictures it names*; `multipart/alternative` holds the two
   * renderings of the message. They go that way round and not the other: the
   * alternatives are alternatives to each other, and the picture is an
   * alternative to nothing.
   *
   * A client that got it inside out shows the logo as a second version of the
   * mail and offers it instead of the text.
   */
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'a@example.org',
      subject: 'x',
      body: 'y',
      html: '<p><img src="cid:sone-mark"></p>',
      inline: [{ cid: 'sone-mark', mime: 'image/png', base64: 'aGVsbG8=' }],
    });

    const outer = /Content-Type: multipart\/related; type="multipart\/alternative"; boundary="([^"]+)"/.exec(
      fake.data,
    )?.[1];
    const inner = /Content-Type: multipart\/alternative; boundary="([^"]+)"/.exec(fake.data)?.[1];
    assert.ok(outer && inner, 'both layers are there');
    assert.notEqual(outer, inner, 'and a shared boundary would end both at once');

    // The angle brackets are the syntax: `cid:sone-mark` finds `<sone-mark>`.
    assert.match(fake.data, /Content-ID: <sone-mark>/);
    assert.match(fake.data, /Content-Transfer-Encoding: base64/);
    assert.match(fake.data, /Content-Disposition: inline/);
    // And the alternative part still comes before the picture, so a client
    // reading in order meets the message first.
    assert.ok(
      fake.data.indexOf('text/html') < fake.data.indexOf('Content-ID:'),
      'the message, then what it refers to',
    );
  } finally {
    await fake.close();
  }
});

test('and a mail with no picture keeps the shape it had', async () => {
  // The counterweight again: an attachment nobody refers to shows up in some
  // clients as a paperclip and a file to download.
  const fake = await fakeRelay();
  try {
    await sendMail(relay(fake.port), {
      to: 'a@example.org',
      subject: 'x',
      body: 'y',
      html: '<p>y</p>',
    });

    assert.doesNotMatch(fake.data, /multipart\/related/);
    assert.doesNotMatch(fake.data, /Content-ID:/);
  } finally {
    await fake.close();
  }
});
