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

/**
 * The rights a role can carry (ADR-0087).
 *
 * A closed list, and short on purpose: it holds exactly the rights that gate
 * something on the server today. `scripts/check-rights-enforced.mjs` fails the
 * build when an entry here is not consulted by any check, because a right
 * nobody checks is a lie — and a lie in a permission screen is worse than a
 * missing feature, since somebody turns the switch off and believes something.
 *
 * So the way to add one is: write the check first, then the entry. Rights for
 * things nobody guards yet — creating pages, emptying the trash, exporting —
 * are deliberately absent. Exporting in particular is worth naming: today any
 * member may export a whole workspace, and tightening that is a change to what
 * SONE does rather than a rename of it, so it does not belong in the change
 * that only moves checks around.
 */
export const RIGHTS = [
  /** Add and remove members, change what role they hold, manage invitations. */
  'people.manage',
  /** Create groups and change who is in them. */
  'groups.manage',
  /** The workspace's name, mark, typography and appearance. */
  'workspace.settings',
] as const;

export type Right = (typeof RIGHTS)[number];

/**
 * What somebody holds in a workspace: one page level, one set of rights.
 *
 * Two parts because the two halves of "what may this person do" have different
 * shapes. `pageLevel` is a ladder — a page is a CRDT document the server either
 * serves or does not, so "may edit but not view" is meaningless — and null is
 * ADR-0087's `none`: nothing without an explicit grant. `rights` is a set,
 * because "may manage groups" and "may change the typography" have no order
 * between them.
 *
 * Where somebody holds several roles — their own and their groups' — this is
 * the union of the rights and the maximum of the page levels. Never a
 * subtraction, for ADR-0026's reason unchanged: being added to a group must
 * never reduce what somebody could already do.
 */
export interface WorkspaceStanding {
  /** Null when they are not in the workspace at all. */
  role: WorkspaceRole | null;
  /** Null for a role that grants nothing by default, and for a non-member. */
  pageLevel: Role | null;
  rights: ReadonlySet<Right>;
  /** Transferring and deleting the workspace, which is not a right. */
  isOwner: boolean;
}

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
