# ADR-0006: Capability-based access, not role-based

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

SONE must support workspace members, named guests without workspace
membership, and anonymous visitors holding a share link — including links that
grant edit rights, with live collaborative editing.

If sharing is added on top of a user/role model later, it becomes a second,
parallel permission system. Half the Notion clones in existence have exactly
that, and the seams show.

## Decision

Authorisation resolves to **claims**, not to an identity. Every connection —
authenticated session or share token — is reduced to the same
`AccessClaims`: a principal, a workspace, an optional workspace role, and a
list of grants over page subtrees.

An anonymous editor is a session with claims and a self-chosen display name.
Not an account. Named guests are accounts without workspace membership.

Two rules that are easy to get wrong and expensive to fix:

1. **The sync server re-checks the ACL on every subdocument open, not only on
   connect.** Otherwise a token scoped to page A can be used to pull the
   document of page B.
2. **Share scope is the page subtree, not the single document.** Without
   `include_subtree`, a shared link breaks the moment somebody adds a subpage.
   `pages.ancestor_ids` exists so this check is one indexed containment test
   rather than a recursive CTE on every open.

Share tokens are stored as hashes; the token itself is displayed once on
creation.

## Consequences

One authorisation path to audit rather than two. Public sharing, guest
accounts and internal permissions are the same mechanism with different claim
sources.

Anonymous editing means writes with no accountable user. `doc_updates.actor_id`
is nullable; attribution for anonymous edits falls back to the share session
and its display name. Instance operators need a way to see and revoke active
share sessions — this belongs in the admin UI, not as an afterthought.

Presence must carry a display name for anonymous participants, or the cursor
labels are useless.

## Alternatives considered

**Role-based permissions with sharing bolted on later.** Rejected, as above.

**Signed stateless tokens (JWT) with no server-side session row.** Attractive
for scale, rejected because revoking a leaked link must be immediate. A
revocable row is the point.
