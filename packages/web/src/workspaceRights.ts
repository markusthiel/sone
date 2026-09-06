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
 * How to name the caller's role on screen.
 *
 * The role's own name, because a custom role has one and has no word: somebody
 * holding "Redaktion" was being told they are a `member`, which is what the
 * enum column said after an assignment that could not name their role.
 */
export const roleLabel = (
  workspace: { role: string; roleName: string } | null | undefined,
  fallback: string,
): string => workspace?.roleName ?? workspace?.role ?? fallback;
