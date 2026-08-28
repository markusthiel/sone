/**
 * SONE — share links.
 *
 * Only the digest is stored, so a leaked database yields no working links and
 * the plaintext exists exactly once: in the response that created it.
 * Revocation is a row update and takes effect on the next request, which is
 * the reason ADR-0006 rejected signed stateless tokens.
 */

import type { Role } from '@sone/core';
import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows } from '../db/pool.js';
import { AuthError, generateToken, hashPassword, hashToken } from './password.js';
import { encryptShareToken } from './shareTokenStore.js';

export interface CreateShareLinkInput {
  /**
   * Used to encrypt the token so the link can be shown again.
   *
   * Absent means it cannot be — the record then holds only the hash, exactly
   * as every link did before this existed.
   */
  secretKey?: string;
  pageId: string;
  createdBy: string;
  role?: Role;
  includeSubtree?: boolean;
  /** Anonymous access is the default; set false to require an account. */
  allowAnonymous?: boolean;
  password?: string | null;
  expiresInDays?: number | null;
}

export interface CreatedShareLink {
  token: string;
  shareTokenId: string;
  expiresAt: Date | null;
}

export async function createShareLink(
  db: Pool | PoolClient,
  input: CreateShareLinkInput,
): Promise<CreatedShareLink> {
  if (input.role === 'admin') {
    // Administration is not something a forwarded URL should confer.
    throw new AuthError('share links cannot grant admin', 'invalid_credentials');
  }

  const page = await queryOne<{ workspace_id: string }>(
    db,
    `SELECT workspace_id FROM pages WHERE id = $1`,
    [input.pageId],
  );
  if (!page) throw new AuthError('page not found', 'not_found');

  const token = generateToken();
  const expiresAt =
    input.expiresInDays == null
      ? null
      : new Date(Date.now() + input.expiresInDays * 86_400_000);

  const passwordHash = input.password ? await hashPassword(input.password) : null;

  const row = await queryOne<{ id: string }>(
    db,
    `INSERT INTO share_tokens
       (workspace_id, scope_page_id, include_subtree, role, token_hash,
        password_hash, allow_anonymous, expires_at, created_by, token_encrypted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      page.workspace_id,
      input.pageId,
      // Subtree is the default. A link that breaks when someone adds a
      // subpage is a bug report waiting to happen.
      input.includeSubtree ?? true,
      input.role ?? 'viewer',
      hashToken(token),
      passwordHash,
      input.allowAnonymous ?? true,
      expiresAt,
      input.createdBy,
      // Kept so the link can be shown again. Encrypted under a key derived
      // from SONE_SECRET_KEY, which is not in the database — see
      // shareTokenStore.ts for why this is not a password and not plaintext.
      //
      // Optional: without a secret the link simply cannot be shown again,
      // which is the behaviour every link had until now.
      input.secretKey ? encryptShareToken(token, input.secretKey) : null,
    ],
  );
  if (!row) throw new Error('failed to create share link');

  return { token, shareTokenId: row.id, expiresAt };
}

export async function revokeShareLink(
  db: Pool | PoolClient,
  shareTokenId: string,
): Promise<void> {
  await db.query(
    `UPDATE share_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [shareTokenId],
  );
  // Sessions created through the link die with it. Without this, an anonymous
  // editor keeps working after the link is revoked, which defeats the point.
  await db.query(
    `DELETE FROM share_sessions WHERE share_token_id = $1`,
    [shareTokenId],
  );
}

export interface ShareLinkSummary {
  id: string;
  scopePageId: string;
  includeSubtree: boolean;
  role: Role;
  hasPassword: boolean;
  allowAnonymous: boolean;
  activeSessions: number;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * Links for a page subtree, with active session counts.
 *
 * The session count is what makes the admin screen useful: "this link is
 * currently being used by four people" is actionable, a list of opaque link
 * ids is not.
 */
export async function listShareLinks(
  db: Pool | PoolClient,
  pageId: string,
  includeDescendants = true,
): Promise<ShareLinkSummary[]> {
  const rows = await queryRows<{
    id: string;
    scope_page_id: string;
    include_subtree: boolean;
    role: Role;
    has_password: boolean;
    allow_anonymous: boolean;
    active_sessions: string;
    expires_at: Date | null;
    created_at: Date;
  }>(
    db,
    `SELECT st.id, st.scope_page_id, st.include_subtree, st.role,
            st.password_hash IS NOT NULL AS has_password,
            st.allow_anonymous,
            (SELECT count(*)::text FROM share_sessions ss
              WHERE ss.share_token_id = st.id AND ss.expires_at > now())
              AS active_sessions,
            st.expires_at, st.created_at
       FROM share_tokens st
      WHERE st.revoked_at IS NULL
        AND (st.scope_page_id = $1
             OR ($2 AND st.scope_page_id IN (
                   SELECT id FROM pages WHERE $1 = ANY(ancestor_ids))))
      ORDER BY st.created_at DESC`,
    [pageId, includeDescendants],
  );

  return rows.map((r) => ({
    id: r.id,
    scopePageId: r.scope_page_id,
    includeSubtree: r.include_subtree,
    role: r.role,
    hasPassword: r.has_password,
    allowAnonymous: r.allow_anonymous,
    activeSessions: Number(r.active_sessions),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

/** Expire stale anonymous sessions. Run by the maintenance job. */
export async function pruneShareSessions(db: Pool): Promise<number> {
  const result = await db.query(`DELETE FROM share_sessions WHERE expires_at < now()`);
  return result.rowCount ?? 0;
}
