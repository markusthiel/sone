/**
 * SONE — cross-instance update bus.
 *
 * Postgres LISTEN/NOTIFY, no Redis (ADR-0005). A dedicated connection outside
 * the pool, because a listening connection is blocked for the pool's purposes
 * and taking one from the pool would eventually starve it.
 *
 * Three channels on that one connection: documents, inboxes (ADR-0093) and page
 * trees (ADR-0096). The cost being avoided above is per connection rather than
 * per channel, so a second listener for a second subject would pay it twice for
 * nothing — and a third for a third.
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

/**
 * Somebody's inbox changed (ADR-0093).
 *
 * A second channel on the same connection rather than a second listener: the
 * reason a listening connection lives outside the pool is that it is blocked
 * for everything else, and that cost is per connection, not per channel.
 */
export const INBOX_CHANNEL = 'sone_inbox_changed';

/**
 * A workspace's page tree changed (ADR-0096).
 *
 * Keyed by workspace rather than by person, which is what a tree is. The third
 * channel on the same connection, and the reason the cost argument above is
 * worth restating: it is per connection, and this adds none.
 */
export const PAGES_CHANNEL = 'sone_pages_changed';

export interface DocUpdateNotice {
  docId: string;
  seq: number;
}

/**
 * Who was affected, and nothing else.
 *
 * No count and no excerpt: a NOTIFY payload reaches every listening instance
 * regardless of who is connected to it, and the inbox route is the one place
 * that decides what a person may see.
 */
export interface InboxNotice {
  userId: string;
}

/** Whose tree, and nothing about what changed in it (ADR-0096). */
export interface PagesNotice {
  workspaceId: string;
}

export type DocUpdateHandler = (notice: DocUpdateNotice) => void;
export type InboxHandler = (notice: InboxNotice) => void;
export type PagesHandler = (notice: PagesNotice) => void;

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
  private readonly inboxHandlers = new Set<InboxHandler>();
  private readonly pagesHandlers = new Set<PagesHandler>();
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

  onInboxChanged(handler: InboxHandler): () => void {
    this.inboxHandlers.add(handler);
    return () => this.inboxHandlers.delete(handler);
  }

  onPagesChanged(handler: PagesHandler): () => void {
    this.pagesHandlers.add(handler);
    return () => this.pagesHandlers.delete(handler);
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
      if (!msg.payload) return;

      if (msg.channel === PAGES_CHANNEL) {
        let workspaceId: unknown;
        try {
          workspaceId = (JSON.parse(msg.payload) as { workspaceId?: unknown }).workspaceId;
        } catch {
          return;
        }
        if (typeof workspaceId !== 'string') return;
        for (const handler of this.pagesHandlers) {
          try {
            handler({ workspaceId });
          } catch (err) {
            console.error('[bus] pages handler threw', err);
          }
        }
        return;
      }

      if (msg.channel === INBOX_CHANNEL) {
        let userId: unknown;
        try {
          userId = (JSON.parse(msg.payload) as { userId?: unknown }).userId;
        } catch {
          return;
        }
        if (typeof userId !== 'string') return;
        for (const handler of this.inboxHandlers) {
          try {
            handler({ userId });
          } catch (err) {
            console.error('[bus] inbox handler threw', err);
          }
        }
        return;
      }

      if (msg.channel !== DOC_UPDATE_CHANNEL) return;
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
    await client.query(`LISTEN ${INBOX_CHANNEL}`);
    await client.query(`LISTEN ${PAGES_CHANNEL}`);
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
    this.inboxHandlers.clear();
    this.pagesHandlers.clear();
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
