/**
 * A minimal sync client for tests.
 *
 * Lifted out of `sync.db.test.ts` when a second file needed it (ADR-0093).
 * Copying it would have been the shorter change and the worse one: two test
 * clients drift, and the one that drifts is the one whose file is not the file
 * somebody is looking at.
 *
 * Collects every frame and lets a test await the one it wants, including frames
 * that arrived before the wait started — which is not a nicety here. A push
 * frame is sent when the server feels like it, so a test that starts listening
 * after triggering the cause is a test that passes or fails by timing.
 */

import { once } from 'node:events';

import WebSocket from 'ws';

import { decodeServerMessage, type DecodedServerMessage } from '../../src/sync/protocol.js';

export class TestClient {
  private readonly received: DecodedServerMessage[] = [];
  private readonly waiters: Array<{
    match: (m: DecodedServerMessage) => boolean;
    resolve: (m: DecodedServerMessage) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = decodeServerMessage(new Uint8Array(data as Buffer));
      this.received.push(message);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i]!;
        if (waiter.match(message)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(i, 1);
          waiter.resolve(message);
        }
      }
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    return new TestClient(socket);
  }

  send(data: Uint8Array): void {
    this.socket.send(data, { binary: true });
  }

  /** Await a frame matching the predicate, checking already-received ones. */
  waitFor(
    match: (m: DecodedServerMessage) => boolean,
    timeoutMs = 4000,
  ): Promise<DecodedServerMessage> {
    const already = this.received.find(match);
    if (already) return Promise.resolve(already);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `timed out waiting for frame; received types: ${this.received
              .map((m) => m.type)
              .join(',')}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ match, resolve, timer });
    });
  }

  waitForType(type: number, timeoutMs = 4000): Promise<DecodedServerMessage> {
    return this.waitFor((m) => m.type === type, timeoutMs);
  }

  /**
   * How many frames of a type have arrived so far.
   *
   * For the assertions that are about *absence* — nobody else was told — which
   * cannot be written as a wait.
   */
  countOfType(type: number): number {
    return this.received.filter((m) => m.type === type).length;
  }

  get frames(): readonly DecodedServerMessage[] {
    return this.received;
  }

  /**
   * Forget everything received so far (ADR-0102).
   *
   * For the assertions that are about absence. Setting somebody up is itself a
   * change — putting them in a workspace nudges that workspace — and a nudge
   * set off by the fixture crosses the bus while the connection is being made,
   * so it lands on either side of the AuthAck depending on the day. Counting
   * from a mark instead of from the beginning is the difference between an
   * assertion that means "this change told nobody" and one that means it most
   * of the time.
   */
  forget(): void {
    this.received.length = 0;
  }

  close(): void {
    this.socket.close();
  }
}
