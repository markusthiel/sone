/**
 * SONE server — the address a notification can be answered at (ADR-0060).
 *
 * The whole security decision of replying by email lives here: **the credential
 * is the address the mail was sent to**, not the address it comes from. A
 * `From` header is forgeable and is treated as decoration; a reply is attributed
 * to whoever the token names.
 *
 * Signed, not stored. There is no table to keep in step with the notification,
 * nothing to sweep, and no row that can go missing while a mail sits in an
 * archive. The cost is that a token cannot be revoked individually — only by
 * changing `SONE_SECRET_KEY`, which revokes every session too. That is the right
 * trade for a fourteen-day credential that can do exactly one thing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a reply address works. */
export const REPLY_DAYS = 14;

export interface ReplyTarget {
  threadId: string;
  messageId: string;
  /** Who the notification went to. A reply is written as this person. */
  userId: string;
  /** Which document the thread lives in — the page's, or its internal one. */
  internal: boolean;
}

/**
 * The signed part, as compact text.
 *
 * Field-separated rather than JSON: a token ends up in an email address, where
 * length is not free and every byte is visible in somebody's mail client.
 */
const payloadOf = (target: ReplyTarget, expiresAt: number): string =>
  [
    target.threadId,
    target.messageId,
    target.userId,
    target.internal ? 'i' : 'p',
    String(expiresAt),
  ].join('~');

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('base64url').slice(0, 27);

/**
 * A token for one notification.
 *
 * The recipient is inside the signature, which is what stops a token taken from
 * one person's mailbox posting as somebody else: it can only post as its owner,
 * which possession of their mailbox already allows.
 */
export function replyToken(
  target: ReplyTarget,
  secret: string,
  now: Date = new Date(),
): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + REPLY_DAYS * 86_400;
  const payload = payloadOf(target, expiresAt);
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, secret)}`;
}

export type ReadReply =
  | { ok: true; target: ReplyTarget }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Read a token, refusing anything it cannot vouch for.
 *
 * The signature is checked *before* the expiry, and both before the payload is
 * believed: an expired token that was never signed by us should be reported as
 * forged rather than as late, because the two say different things about who
 * sent it.
 */
export function readReplyToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): ReadReply {
  const at = token.lastIndexOf('.');
  if (at < 1) return { ok: false, reason: 'malformed' };

  const payload = Buffer.from(token.slice(0, at), 'base64url').toString('utf8');
  const given = token.slice(at + 1);
  const expected = sign(payload, secret);

  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const parts = payload.split('~');
  if (parts.length !== 5) return { ok: false, reason: 'malformed' };
  const [threadId, messageId, userId, where, expiry] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };
  if (expiresAt * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, target: { threadId, messageId, userId, internal: where === 'i' } };
}

/**
 * The address a reply goes to.
 *
 * Sub-addressing, because every mailbox that supports it delivers `a+b@c` to
 * `a@c` — so one mailbox serves every notification without a catch-all domain,
 * which is the difference between "configure a mailbox" and "configure DNS".
 */
export function replyAddress(mailbox: string, token: string): string {
  const at = mailbox.indexOf('@');
  if (at < 1) return mailbox;
  return `${mailbox.slice(0, at)}+${token}@${mailbox.slice(at + 1)}`;
}

/** The token out of an address a mail was delivered to, if there is one. */
export function tokenFromAddress(address: string): string | null {
  const match = /\+([A-Za-z0-9_.-]+)@/.exec(address);
  return match?.[1] ?? null;
}
