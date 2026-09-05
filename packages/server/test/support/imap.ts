/**
 * A server that speaks IMAP, for tests that need one.
 *
 * Lifted out of `imap.test.ts` unchanged when a second file needed it: the
 * reply poll (ADR-0060) had no test at all, and the only honest way to test it
 * is to let it fetch its mail the way it does in production rather than to hand
 * it a mock and check the mock.
 *
 * It keeps the one property that makes it worth having — messages are served as
 * literals, with a byte count, so a client that reads line by line and stops at
 * its own tag is caught truncating.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer } from 'node:tls';

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

export interface FakeImap {
  port: number;
  close: () => Promise<void>;
  /** Every line the client sent, in order. */
  said: string[];
  /** Sequence numbers the client marked read. */
  markedRead: () => number[];
}

export async function fakeImap(messages: string[]): Promise<FakeImap> {
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
        else if (upper === 'SELECT') {
          socket.write(`* ${messages.length} EXISTS\r\n${tag} OK selected\r\n`);
        } else if (upper === 'SEARCH') {
          const unseen = messages.map((_, at) => at + 1).filter((n) => !stored.has(n));
          socket.write(`* SEARCH ${unseen.join(' ')}\r\n${tag} OK done\r\n`);
        } else if (upper === 'FETCH') {
          const seq = Number(rest[0]);
          const body = messages[seq - 1] ?? '';
          /*
           * A message is a string of *bytes*: one character, one byte, latin1
           * both when counting and when writing.
           *
           * Counting in latin1 and then writing the string with Node's default
           * utf8 encoding announces a byte count the payload does not have, so
           * anything non-ASCII makes the literal short and truncates the mail —
           * a fault in the fake that would look exactly like a client bug. A
           * test that wants a utf-8 body builds it with `Buffer.from(text,
           * 'utf8').toString('latin1')`, which is what a real server sends.
           */
          socket.write(`* ${seq} FETCH (BODY[] {${Buffer.byteLength(body, 'latin1')}}\r\n`);
          socket.write(Buffer.from(body, 'latin1'));
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
    markedRead: () => [...stored].sort((a, b) => a - b),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const mailboxAt = (port: number) => ({
  host: 'localhost',
  port,
  user: 'sone@example.org',
  password: 'geheim',
  folder: 'INBOX',
});
