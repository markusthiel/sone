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
  /** Plain text. An HTML part is a second thing to keep true. */
  body: string;
  /**
   * Where a reply should go, when one can be accepted (ADR-0060).
   *
   * A per-notification address carrying a signed token, so the address a reply
   * was sent *to* is the credential and the `From` header stays decoration.
   */
  replyTo?: string;
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
class Session {
  private buffer = '';
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
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
          continue;
        }
        this.buffer = this.buffer.slice(end + 2);
        const code = Number.parseInt(line.slice(0, 3), 10);
        const resolve = this.waiting;
        this.waiting = null;
        this.failed = null;
        resolve?.({ code, text: line.slice(4) });
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
    this.attach();
  }

  reply(): Promise<{ code: number; text: string }> {
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

  async say(line: string, expect: number[]): Promise<{ code: number; text: string }> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!expect.includes(reply.code)) {
      throw new SmtpError(`${line.split(' ')[0]}: ${reply.code} ${reply.text}`, reply.code);
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

export async function sendMail(relay: Relay, message: Message, now = new Date()): Promise<void> {
  const socket: Socket | TLSSocket =
    relay.security === 'tls'
      ? tlsConnect({ host: relay.host, port: relay.port })
      : createConnection({ host: relay.host, port: relay.port });

  const session = new Session(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once(relay.security === 'tls' ? 'secureConnect' : 'connect', () => resolve());
      socket.once('error', reject);
    });

    await session.reply(); // the greeting
    await session.say('EHLO sone', [250]);

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
      await session.say('EHLO sone', [250]);
    }

    if (relay.user !== '') {
      // AUTH PLAIN, which is one round trip. Only over an encrypted connection:
      // a password in the clear is worse than no mail.
      if (relay.security === 'none') {
        throw new SmtpError('refusing to send a password over an unencrypted connection', null);
      }
      const credential = Buffer.from(`\0${relay.user}\0${relay.password}`, 'utf8').toString(
        'base64',
      );
      await session.say(`AUTH PLAIN ${credential}`, [235]);
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

    const headers = [
      `From: ${relay.from}`,
      `To: ${to}`,
      `Subject: ${headerSafe(message.subject)}`,
      `Date: ${now.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      // For clients that offer the button. It points at the authenticated
      // settings page, which is worse than one click and is the version that
      // cannot be used against the recipient (ADR-0058).
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

    session.write(`${headers}\r\n\r\n${forData(message.body)}\r\n.\r\n`);
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
