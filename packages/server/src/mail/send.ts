/**
 * SONE server — handing one mail to one relay (ADR-0058).
 *
 * Written rather than depended on, and that is a trade worth stating. Sending
 * mail in general is a large problem: queues, bounces, DKIM, dozens of servers
 * behaving differently. Handing a message to *one relay an operator configured*
 * is a small one — EHLO, STARTTLS, AUTH, MAIL FROM, RCPT TO, DATA — and the
 * server has six runtime dependencies, which is a number worth keeping.
 *
 * The honesty condition on that trade is that it is tested against something
 * that speaks back rather than against my idea of what a relay says. There is a
 * fake server in the tests for exactly that: multi-line replies, dot-stuffing
 * and header injection are handled here because they are the classic ways a
 * hand-written client is wrong, and the tests are there so that claim is
 * checked rather than asserted in a comment.
 *
 * What this deliberately does not do: pipelining, 8BITMIME, DSN, retrying
 * inside a session. One mail per connection, and the job queue owns retries.
 */

import { randomBytes } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export interface Relay {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  security: 'starttls' | 'tls' | 'none';
}

export interface Message {
  to: string;
  subject: string;
  /**
   * Plain text, always.
   *
   * Not a fallback: a text-only client, a screen reader set to prefer it and a
   * mailing list that strips HTML all get this, and it says everything the
   * other part says — both are rendered from one letter (ADR-0121).
   */
  body: string;
  /**
   * The same letter, drawn (ADR-0121).
   *
   * Optional, and most mails have none. The file said "an HTML part is a second
   * thing to keep true", which is right about two *documents*: here both parts
   * come from one structure, so a line reaching one and not the other is not a
   * mistake that can be made.
   */
  html?: string;
  /**
   * Pictures the HTML part refers to by `cid:` (ADR-0132).
   *
   * Attachments, never links. A remote image in a mail reports when it was
   * opened and roughly from where, and this project does not measure that
   * (ADR-0058) — so the one picture a mail carries travels with it.
   *
   * Present only where the HTML part actually names them: an attachment nobody
   * refers to shows up in some clients as a paperclip and a file to download.
   */
  inline?: Array<{ cid: string; mime: string; base64: string }>;
  /**
   * Where a reply should go, when one can be accepted (ADR-0060).
   *
   * A per-notification address carrying a signed token, so the address a reply
   * was sent *to* is the credential and the `From` header stays decoration.
   */
  replyTo?: string;
  /**
   * Where somebody turns this off, for the clients that offer the button.
   *
   * ADR-0058 says this header is included. It was not: the comment describing
   * it survived and the line under it became `Auto-Submitted`, so the whole
   * repository held the string `List-Unsubscribe` once, in the record
   * (ADR-0081).
   *
   * A URL only, and no `List-Unsubscribe-Post`: the one-click form of this
   * header lets anybody who can send a request unsubscribe somebody else, and
   * the page it points at is behind a sign-in for that reason.
   */
  unsubscribeUrl?: string;
}

/** How long any single exchange may take before the attempt is abandoned. */
const STEP_TIMEOUT_MS = 20_000;

class SmtpError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

/**
 * One line-oriented conversation.
 *
 * SMTP replies can span several lines — `250-STARTTLS` then `250 AUTH ...` —
 * and a reply is finished only when a line's fourth character is a space. A
 * client that reads one line and moves on works against a relay that answers
 * EHLO in one line and hangs against every real one, which is why the fake
 * server in the tests answers in four.
 */
interface Reply {
  code: number;
  /** The last line's text — the one a client acts on. */
  text: string;
  /**
   * Every line's text, continuation lines included.
   *
   * An EHLO reply is the one place this matters: `250-AUTH LOGIN XOAUTH2` is a
   * continuation line, and it is the line that says which mechanisms the relay
   * accepts. The first version of this client kept only the last line and
   * knew nothing about the ones before it.
   */
  lines: string[];
}

class Session {
  private buffer = '';
  private lines: string[] = [];
  private waiting: ((reply: Reply) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;

  constructor(private socket: Socket | TLSSocket) {
    this.attach();
  }

  private attach(): void {
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const end = this.buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = this.buffer.slice(0, end);
        // Only consume the line once it completes a reply; continuation lines
        // stay in the buffer until the final one arrives.
        if (line.length >= 4 && line[3] === '-') {
          this.buffer = this.buffer.slice(end + 2);
          this.lines.push(line.slice(4));
          continue;
        }
        this.buffer = this.buffer.slice(end + 2);
        const code = Number.parseInt(line.slice(0, 3), 10);
        const lines = [...this.lines, line.slice(4)];
        this.lines = [];
        const resolve = this.waiting;
        this.waiting = null;
        this.failed = null;
        resolve?.({ code, text: line.slice(4), lines });
        return;
      }
    });
    this.socket.on('error', (error: Error) => {
      const reject = this.failed;
      this.waiting = null;
      this.failed = null;
      reject?.(error);
    });
  }

  /** Replace the socket after STARTTLS, keeping nothing of the old buffer. */
  upgrade(socket: TLSSocket): void {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.attach();
  }

  reply(): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        this.failed = null;
        reject(new SmtpError('the relay did not answer', null));
      }, STEP_TIMEOUT_MS);

      this.waiting = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.failed = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  /**
   * Send one line, expect one of the given codes.
   *
   * `label` names the step in the error when the line itself must not: the
   * credential lines of AUTH LOGIN are the password, base64 — and the error
   * ends up on an administrator's screen and in the log.
   */
  async say(line: string, expect: number[], label = line.split(' ')[0]): Promise<Reply> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!expect.includes(reply.code)) {
      throw new SmtpError(`${label}: ${reply.code} ${reply.text}`, reply.code);
    }
    return reply;
  }

  write(data: string): void {
    this.socket.write(data);
  }

  get raw(): Socket | TLSSocket {
    return this.socket;
  }

  end(): void {
    this.socket.end();
  }
}

/**
 * Escape a message body for DATA.
 *
 * A line that is a single dot ends the message, so a body containing one would
 * truncate the mail — and a body is text somebody wrote. Dot-stuffing is the
 * protocol's answer and it is two lines; missing it is the classic way a mail
 * arrives cut in half.
 */
function forData(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/** A header value that cannot inject headers of its own. */
function headerSafe(value: string): string {
  // A subject with a newline in it would let anything after the newline become
  // a header — a Bcc, for instance. Page titles reach the subject line, and a
  // page title is text somebody typed.
  return value.replace(/[\r\n]+/g, ' ').slice(0, 200);
}

/**
 * Open the connection a relay's settings describe, and wait until it is up.
 *
 * Separate from the conversation so a test can hand in a socket to a fake that
 * speaks no TLS and still exercise the part of the conversation that only ever
 * happens over TLS — the authentication. That part was the one part the fake
 * never heard, and it was wrong (see `authenticate`).
 */
export type Dial = (relay: Relay) => Promise<Socket | TLSSocket>;

const dialRelay: Dial = async (relay) => {
  const socket: Socket | TLSSocket =
    relay.security === 'tls'
      ? tlsConnect({ host: relay.host, port: relay.port })
      : createConnection({ host: relay.host, port: relay.port });
  await new Promise<void>((resolve, reject) => {
    socket.once(relay.security === 'tls' ? 'secureConnect' : 'connect', () => resolve());
    socket.once('error', reject);
  });
  return socket;
};

/**
 * The mechanisms a relay said it accepts, read off its EHLO reply.
 *
 * `null` when the relay did not say: the extension is optional to advertise,
 * and a relay that keeps quiet is not one that refuses.
 */
export function offeredAuth(ehlo: string[]): string[] | null {
  for (const line of ehlo) {
    // `AUTH PLAIN LOGIN` per RFC 4954; `AUTH=PLAIN LOGIN` is the older form some
    // relays still send alongside it.
    const match = /^AUTH[ =](.+)$/i.exec(line.trim());
    if (match?.[1]) return match[1].split(/\s+/).filter(Boolean).map((m) => m.toUpperCase());
  }
  return null;
}

/**
 * Hand over the password, the way this relay wants it.
 *
 * PLAIN when it is offered: one round trip. LOGIN when only that is: two
 * challenges, user then password, each base64. Exchange Online is the relay
 * that made the second one necessary — after STARTTLS it announces
 * `AUTH LOGIN XOAUTH2` and answers PLAIN with `504 5.7.4 Unrecognized
 * authentication type`, which reads like a wrong password and is not one.
 *
 * A relay that announces neither gets told so, with what it did announce: an
 * operator whose tenant has switched to OAuth-only sees the word XOAUTH2 in the
 * error rather than a 504 to search for.
 */
async function authenticate(session: Session, relay: Relay, ehlo: string[]): Promise<void> {
  const offered = offeredAuth(ehlo);
  const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

  // A relay that did not say is tried with PLAIN, as before this was read at all.
  if (offered === null || offered.includes('PLAIN')) {
    await session.say(`AUTH PLAIN ${b64(`\0${relay.user}\0${relay.password}`)}`, [235]);
    return;
  }
  if (offered.includes('LOGIN')) {
    await session.say('AUTH LOGIN', [334]);
    await session.say(b64(relay.user), [334], 'AUTH');
    await session.say(b64(relay.password), [235], 'AUTH');
    return;
  }
  throw new SmtpError(
    `the relay accepts a password by none of the mechanisms SONE speaks (PLAIN, LOGIN); ` +
      `it offers: ${offered.join(' ') || 'nothing'}`,
    null,
  );
}

export async function sendMail(
  relay: Relay,
  message: Message,
  now = new Date(),
  dial: Dial = dialRelay,
): Promise<void> {
  const socket = await dial(relay);
  const session = new Session(socket);
  try {
    await session.reply(); // the greeting
    let ehlo = await session.say('EHLO sone', [250]);

    if (relay.security === 'starttls') {
      await session.say('STARTTLS', [220]);
      const secure = tlsConnect({ socket: session.raw as Socket, servername: relay.host });
      await new Promise<void>((resolve, reject) => {
        secure.once('secureConnect', () => resolve());
        secure.once('error', reject);
      });
      session.upgrade(secure);
      // EHLO again after the upgrade: the capability list before it was sent in
      // the clear and cannot be trusted, and the specification requires it.
      ehlo = await session.say('EHLO sone', [250]);
    }

    if (relay.user !== '') {
      // Only over an encrypted connection: a password in the clear is worse
      // than no mail.
      if (relay.security === 'none') {
        throw new SmtpError('refusing to send a password over an unencrypted connection', null);
      }
      await authenticate(session, relay, ehlo.lines);
    }

    /*
     * The recipient is made header-safe too.
     *
     * Every other caller passes an address out of `users.email`, so this was
     * never load-bearing — until refusals started going to an address read out
     * of an arriving mail's `From` header, which is text a stranger wrote. It
     * is parsed before it gets here (`addressIn`), and this is the second lock
     * on the same door: a recipient is never the place where a header gets
     * invented.
     */
    const to = headerSafe(message.to);
    await session.say(`MAIL FROM:<${relay.from}>`, [250]);
    await session.say(`RCPT TO:<${to}>`, [250, 251]);
    await session.say('DATA', [354]);

    /*
     * A boundary no body can contain (ADR-0121).
     *
     * A part ends at a line that is the boundary, so a message containing that
     * string would end early and the rest would arrive as MIME wreckage. Random
     * per message rather than a constant: a constant is one somebody's page
     * title eventually contains, and the failure is silent.
     */
    const boundary = `sone-${randomBytes(16).toString('hex')}`;
    /*
     * A second boundary, for the layer around it (ADR-0132).
     *
     * `multipart/related` holds the message *and the pictures it names*;
     * `multipart/alternative` holds the two renderings of the message. They
     * nest that way round and not the other: the alternatives are alternatives
     * to each other, and the picture is an alternative to nothing.
     *
     * Distinct from the inner one, because a part ends at *its own* boundary
     * and a shared string would end both at once.
     */
    const related = `sone-rel-${randomBytes(16).toString('hex')}`;
    const inline = message.html === undefined ? [] : (message.inline ?? []);

    const headers = [
      `From: ${relay.from}`,
      `To: ${to}`,
      `Subject: ${headerSafe(message.subject)}`,
      `Date: ${now.toUTCString()}`,
      'MIME-Version: 1.0',
      message.html === undefined
        ? 'Content-Type: text/plain; charset=utf-8'
        : inline.length === 0
          ? `Content-Type: multipart/alternative; boundary="${boundary}"`
          : // `type` names what the related parts are related *to*, which is how
            // a client knows which part to show rather than guessing the first.
            `Content-Type: multipart/related; type="multipart/alternative"; ` +
            `boundary="${related}"`,
      // For clients that offer the button. It points at the authenticated
      // settings page, which is worse than one click and is the version that
      // cannot be used against the recipient (ADR-0058).
      ...(message.unsubscribeUrl
        ? [`List-Unsubscribe: <${headerSafe(message.unsubscribeUrl)}>`]
        : []),
      /*
       * `auto-replied` rather than `auto-generated` when a reply is invited.
       *
       * Both tell an out-of-office responder not to answer, which is the point
       * — a holiday autoresponder replying to a notification would arrive here
       * as a comment. Announcing it as auto-generated while asking for a reply
       * would be telling two things at once.
       */
      message.replyTo ? 'Auto-Submitted: auto-replied' : 'Auto-Submitted: auto-generated',
      ...(message.replyTo ? [`Reply-To: ${headerSafe(message.replyTo)}`] : []),
    ].join('\r\n');

    /*
     * Text first, HTML last.
     *
     * `multipart/alternative` means "the same thing, twice", and the order is
     * the contract: a client shows the **last** part it can display. Reversed,
     * every graphical client would show the plain text — which is why this is
     * the one thing about MIME worth a comment.
     */
    const alternative = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      forData(message.body),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      forData(message.html ?? ''),
      `--${boundary}--`,
    ].join('\r\n');

    const content =
      message.html === undefined
        ? forData(message.body)
        : inline.length === 0
          ? alternative
          : [
              `--${related}`,
              `Content-Type: multipart/alternative; boundary="${boundary}"`,
              '',
              alternative,
              ...inline.flatMap((picture) => [
                `--${related}`,
                `Content-Type: ${headerSafe(picture.mime)}`,
                // The angle brackets are the syntax: `cid:sone-mark` in the
                // HTML refers to `Content-ID: <sone-mark>`, and a client that
                // does not find the brackets does not find the picture.
                `Content-ID: <${headerSafe(picture.cid)}>`,
                'Content-Disposition: inline',
                'Content-Transfer-Encoding: base64',
                '',
                // Already base64, so nothing here needs dot-stuffing — but it
                // goes through the same writer as everything else rather than
                // being trusted to contain no line that starts with a dot.
                forData(picture.base64.replace(/(.{76})/g, '$1\n')),
              ]),
              `--${related}--`,
            ].join('\r\n');

    session.write(`${headers}\r\n\r\n${content}\r\n.\r\n`);
    await session.reply().then((reply) => {
      if (reply.code !== 250) {
        throw new SmtpError(`the relay refused the message: ${reply.code} ${reply.text}`, reply.code);
      }
    });

    await session.say('QUIT', [221]).catch(() => {
      // A relay that closes without answering QUIT has still accepted the
      // message, and failing here would make the job retry a mail that arrived.
    });
  } finally {
    session.end();
  }
}
