/**
 * SONE web — what the caller may do in a workspace (ADR-0102).
 *
 * The companion to `entryRights.ts` one layer out, and it exists for the same
 * reason: **no second place for rights.** This is a reading of the answer the
 * server already sent with the session, not a rule of its own — every write is
 * still refused by the route that receives it. What it buys is a screen that
 * does not offer what will be refused.
 *
 * It replaces `role === 'owner' || role === 'admin'`, which was not the rule
 * any route enforced. The routes ask for a named right (ADR-0087), and the two
 * agreed only for as long as the four system roles were the only roles — so
 * somebody holding `workspace.settings` through a custom role or a group got a
 * screen of disabled controls and no explanation.
 */

import { nameOfRole, type SystemRoleKey } from '@sone/core';

/** The shape the session and the workspace listing both send (ADR-0102). */
export interface WorkspaceStandingView {
  rights: readonly string[];
}

/**
 * Whether somebody may change this workspace's settings.
 *
 * `manages` is the instance-wide workspace-management right, which is how
 * somebody administers a workspace they are not in — a separate question from
 * anything on the membership, and the route accepts either.
 *
 * Undefined means the workspace is not one of the caller's own and has not been
 * fetched: no standing, so the instance right is the only way through.
 */
export const mayEditWorkspace = (
  workspace: WorkspaceStandingView | null | undefined,
  manages: boolean,
): boolean => manages || workspace?.rights.includes('workspace.settings') === true;

/**
 * How to name a role on screen.
 *
 * The role's own name, because a custom role has one and has no word: somebody
 * holding "Redaktion" was being told they are a `member`, which is what the
 * enum column said after an assignment that could not name their role.
 *
 * **And the four system roles are named by their word** (ADR-0143). Their rows
 * are seeded in English by a migration, so returning the row's `name` put
 * "Owner" in a German interface — here, and only here, because the three
 * screens that draw a role list had each written the condition out for
 * themselves and this one had not.
 *
 * The key is built here rather than at the four call sites, which is what makes
 * "one place decides" checkable rather than a habit.
 */
export const roleLabel = (
  role: { key?: string | null | undefined; name?: string | null | undefined } | null | undefined,
  translate: (key: `role.${SystemRoleKey}`) => string,
  fallback = '',
): string => (role ? nameOfRole(role, (key) => translate(`role.${key}`)) || fallback : fallback);
