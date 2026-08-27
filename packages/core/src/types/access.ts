/**
 * SONE — access control.
 *
 * Authorisation resolves to *claims*, not to an identity. A logged-in member,
 * a named guest and an anonymous visitor holding a share link all arrive at
 * the sync server as a set of capabilities over a page subtree. That is the
 * only way link-based editing works without bolting a parallel permission
 * system onto the side later (ADR-0006).
 */

import type {
  PageId,
  ShareTokenId,
  Timestamp,
  UserId,
  WorkspaceId,
} from './ids.js';

/** Ordered from least to most privileged; comparison is by index. */
export const ROLE_ORDER = ['viewer', 'commenter', 'editor', 'admin'] as const;
export type Role = (typeof ROLE_ORDER)[number];

export const atLeast = (have: Role, need: Role) =>
  ROLE_ORDER.indexOf(have) >= ROLE_ORDER.indexOf(need);

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export interface WorkspaceMember {
  workspaceId: WorkspaceId;
  userId: UserId;
  role: WorkspaceRole;
  joinedAt: Timestamp;
}

/**
 * A share token grants a role over a page and, optionally, everything below
 * it. Subtree scope is not a convenience — without it a shared link breaks
 * the moment somebody adds a subpage.
 */
export interface ShareToken {
  id: ShareTokenId;
  workspaceId: WorkspaceId;
  scopePageId: PageId;
  includeSubtree: boolean;
  role: Role;
  /** Present when the link is password protected. */
  hasPassword: boolean;
  expiresAt: Timestamp | null;
  /** Anonymous visitors may edit only if this is true. */
  allowAnonymous: boolean;
  createdBy: UserId;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;
}

export type Principal =
  | { kind: 'user'; userId: UserId }
  | { kind: 'guest'; userId: UserId }
  | { kind: 'anonymous'; sessionId: string; displayName: string };

/**
 * The resolved capability set for one connection.
 *
 * The sync server must re-check this on every subdocument open, not only on
 * connect. A token scoped to page A must not be usable to pull the document
 * of page B.
 */
export interface AccessClaims {
  principal: Principal;
  workspaceId: WorkspaceId;
  /** Workspace-wide role, absent for anonymous share-link sessions. */
  workspaceRole: WorkspaceRole | null;
  /** Explicit grants from share tokens. */
  grants: Array<{
    scopePageId: PageId;
    includeSubtree: boolean;
    role: Role;
    tokenId: ShareTokenId;
  }>;
  issuedAt: Timestamp;
  expiresAt: Timestamp | null;
}

/** Presence payload broadcast over the awareness channel. */
export interface PresenceState {
  displayName: string;
  color: string;
  /** Null for anonymous visitors. */
  userId: UserId | null;
  isAnonymous: boolean;
}
