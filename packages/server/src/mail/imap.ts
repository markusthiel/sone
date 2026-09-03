/**
 * SONE server — reading unread mail out of one mailbox (ADR-0060).
 *
 * Six commands: LOGIN, SELECT, SEARCH UNSEEN, FETCH, STORE, LOGOUT. Written
 * rather than depended on for the same reason the SMTP client was — this is a
 * fraction of IMAP, and the fraction is fixed by what the record decided.
 *
 * The part that hand-written IMAP clients get wrong is **literals**. A server
 * answers a FETCH with `{1234}` followed by exactly that many bytes, which may
 * contain anything at all including blank lines and the string `OK`. A client
 * that reads line by line and looks for its tag will find one inside somebody's
 * mail and truncate the message there. So this counts bytes.
 *
 * What it does not do: IDLE, UIDs across sessions, partial fetches, any
 * extension. One poll opens a connection, takes what is unread, and closes.
 */

import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export interface Mailbox {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Which folder to read. Almost always INBOX. */
  folder: string;
}

export interface FetchedMessage {
  /** The sequence number, for marking it read in this same session. */
  seq: number;
  /** The whole message, headers and body. */
  raw: string;
}

/** How long any single exchange may take before the poll is abandoned. */
const STEP_TIMEOUT_MS = 30_000;

/** Refuse a mailbox that would need more than this in one poll. */
const MAX_PER_POLL = 50;
const MAX_MESSAGE_BYTES = 1_000_000;

class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImapError';
  }
}

/**
 * One connection, reading by bytes rather than by lines.
 *
 * The buffer is a string and the literal count is in characters, which is
 * correct only because the socket is read as latin1 — one byte, one character.
 * The message is re-decoded properly later by the MIME reader, which knows the
 * charset; decoding as UTF-8 here would make a byte count wrong for any mail
 * containing an umlaut, and the truncation would land mid-message.
 */
class Session {
  private buffer = '';
  private waiting: (() => void) | null = null;

  constructor(private readonly socket: TLSSocket) {
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      const wake = this.waiting;
      this.waiting = null;
      wake?.();
    });
  }

  private more(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new ImapError('the mailbox did not answer'));
      }, STEP_TIMEOUT_MS);
      this.waiting = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** Take one line, waiting for it if necessary. */
  private async line(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end !== -1) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        return line;
      }
      await this.more();
    }
  }

  /** Take exactly this many characters, which are bytes here. */
  private async bytes(count: number): Promise<string> {
    while (this.buffer.length < count) await this.more();
    const taken = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return taken;
  }

  /**
   * Send a command and collect everything until its tagged response.
   *
   * Literals are consumed as counted bytes, so a tag or an `OK` inside a
   * message body cannot end the read early.
   */
  async send(tag: string, command: string): Promise<string[]> {
    this.socket.write(`${tag} ${command}\r\n`);
    const lines: string[] = [];

    for (;;) {
      let line = await this.line();

      const literal = /\{(\d+)\}$/.exec(line);
      if (literal) {
        const size = Number(literal[1]);
        if (size > MAX_MESSAGE_BYTES) {
          throw new ImapError(`a message of ${size} bytes is more than this reads`);
        }
        const body = await this.bytes(size);
        // The literal replaces its own announcement, so the caller sees one
        // line with the content where the `{1234}` was.
        line = `${line.slice(0, literal.index)}${body}`;
        // And what follows on that line, up to its real end.
        line += await this.line();
      }

      if (line.startsWith(`${tag} `)) {
        if (!/^\S+ OK\b/.test(line)) throw new ImapError(line.slice(tag.length + 1));
        return lines;
      }
      lines.push(line);
    }
  }

  greeting(): Promise<string> {
    return this.line();
  }

  end(): void {
    this.socket.end();
  }
}

/** A string as IMAP wants it: quoted, with the two characters that need escaping. */
const quoted = (value: string): string => `"${value.replace(/([\\"])/g, '\\$1')}"`;

/**
 * Read the unread messages, and mark exactly those read.
 *
 * Marked in the same session, by sequence number, because a second connection
 * would have different numbers — and marking the wrong message read is how a
 * mailbox somebody else uses loses their mail to us.
 *
 * Messages this cannot use are still marked read by the *caller*, not here:
 * whether an unrecognised mail should be left alone is a decision about the
 * feature, not about the protocol.
 */
export async function fetchUnread(
  mailbox: Mailbox,
  handle: (message: FetchedMessage) => Promise<'read' | 'leave'>,
): Promise<{ seen: number; left: number }> {
  const socket = tlsConnect({ host: mailbox.host, port: mailbox.port });
  const session = new Session(socket);
  let tag = 0;
  const next = (): string => `a${(tag += 1)}`;

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', () => resolve());
      socket.once('error', reject);
    });
    await session.greeting();

    await session.send(next(), `LOGIN ${quoted(mailbox.user)} ${quoted(mailbox.password)}`);
    await session.send(next(), `SELECT ${quoted(mailbox.folder)}`);

    const found = await session.send(next(), 'SEARCH UNSEEN');
    const numbers = found
      .filter((line) => /^\* SEARCH/i.test(line))
      .flatMap((line) => line.replace(/^\* SEARCH\s*/i, '').split(/\s+/))
      .filter((one) => /^\d+$/.test(one))
      .map(Number)
      .slice(0, MAX_PER_POLL);

    let seen = 0;
    let left = 0;
    for (const seq of numbers) {
      // BODY.PEEK, so fetching does not mark it read: what is marked read is
      // decided by the handler, one message at a time.
      const lines = await session.send(next(), `FETCH ${seq} (BODY.PEEK[])`);
      const raw = lines.find((line) => /^\* \d+ FETCH/i.test(line)) ?? '';
      const start = raw.indexOf('BODY[]');
      const message = start === -1 ? '' : raw.slice(raw.indexOf(' ', start) + 1).replace(/\)$/, '');

      const verdict = await handle({ seq, raw: message });
      if (verdict === 'read') {
        await session.send(next(), `STORE ${seq} +FLAGS (\\Seen)`);
        seen += 1;
      } else {
        left += 1;
      }
    }

    await session.send(next(), 'LOGOUT').catch(() => {
      // A server that closes without answering LOGOUT has still done everything
      // asked of it, and failing here would make the next poll repeat the work.
    });
    return { seen, left };
  } finally {
    session.end();
  }
}
