/**
 * SONE — cross-instance update bus.
 *
 * Postgres LISTEN/NOTIFY, no Redis (ADR-0005). A dedicated connection outside
 * the pool, because a listening connection is blocked for the pool's purposes
 * and taking one from the pool would eventually starve it.
 *
 * Two properties of NOTIFY drive the design:
 *
 *   - The payload is capped at 8000 bytes, so notifications carry ids only,
 *     never document content. A peer that hears about a new sequence number
 *     fetches the update from doc_updates itself.
 *   - It is not durable. A listener that is down misses messages entirely.
 *     Therefore reconciliation on (re)connect is mandatory, not an
 *     optimisation: every subscriber compares sequence numbers rather than
 *     trusting that it heard about everything.
 */

import { Client, type Pool } from 'pg';

import { queryRows } from '../db/pool.js';

export const DOC_UPDATE_CHANNEL = 'sone_doc_update';

export interface DocUpdateNotice {
  docId: string;
  seq: number;
}

export type DocUpdateHandler = (notice: DocUpdateNotice) => void;

/**
 * Listens for document updates produced by other instances.
 *
 * Reconnects with backoff. A bus that silently stops listening turns a cluster
 * into isolated instances whose documents diverge until the next cold open, so
 * failures are logged loudly rather than swallowed.
 */
export class UpdateBus {
  private client: Client | null = null;
  private readonly handlers = new Set<DocUpdateHandler>();
  private stopped = false;
  private reconnectDelayMs = 500;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** Instance identity, so an instance ignores its own notifications. */
  readonly instanceId: string;

  constructor(
    private readonly databaseUrl: string,
    instanceId?: string,
  ) {
    this.instanceId = instanceId ?? `${process.pid}-${Date.now().toString(36)}`;
  }

  onUpdate(handler: DocUpdateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    if (this.stopped) throw new Error('bus already stopped');
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new Client({
      connectionString: this.databaseUrl,
      application_name: `sone-bus-${this.instanceId}`,
    });

    client.on('notification', (msg) => {
      if (msg.channel !== DOC_UPDATE_CHANNEL || !msg.payload) return;
      let notice: DocUpdateNotice;
      try {
        const parsed = JSON.parse(msg.payload) as { docId?: unknown; seq?: unknown };
        if (typeof parsed.docId !== 'string' || typeof parsed.seq !== 'number') return;
        notice = { docId: parsed.docId, seq: parsed.seq };
      } catch {
        return;
      }
      for (const handler of this.handlers) {
        try {
          handler(notice);
        } catch (err) {
          console.error('[bus] handler threw', err);
        }
      }
    });

    client.on('error', (err) => {
      console.error('[bus] connection error', err);
      this.scheduleReconnect();
    });

    client.on('end', () => {
      if (!this.stopped) this.scheduleReconnect();
    });

    await client.connect();
    await client.query(`LISTEN ${DOC_UPDATE_CHANNEL}`);
    this.client = client;
    this.reconnectDelayMs = 500;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, 30_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err) => {
        console.error('[bus] reconnect failed', err);
        this.scheduleReconnect();
      });
    }, delay);

    console.warn(`[bus] reconnecting in ${delay} ms`);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.handlers.clear();
    if (this.client) {
      const client = this.client;
      this.client = null;
      await client.end().catch(() => {
        // Shutting down; a failure to close cleanly changes nothing.
      });
    }
  }
}

/**
 * Fetch updates a room has not applied yet.
 *
 * The reconciliation half of the bargain above. Called both when a
 * notification arrives and unconditionally on reconnect, because a missed
 * notification is indistinguishable from no notification.
 */
export async function fetchUpdatesSince(
  pool: Pool,
  docId: string,
  sinceSeq: number,
): Promise<Array<{ seq: number; payload: Uint8Array }>> {
  const rows = await queryRows<{ seq: string; payload: Buffer }>(
    pool,
    `SELECT seq, payload FROM doc_updates
      WHERE doc_id = $1 AND seq > $2
      ORDER BY seq ASC`,
    [docId, sinceSeq],
  );
  return rows.map((r) => ({ seq: Number(r.seq), payload: new Uint8Array(r.payload) }));
}
