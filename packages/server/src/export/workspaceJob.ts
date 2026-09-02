/**
 * SONE server — exporting a whole workspace, as a job (ADR-0044).
 *
 * The kind of export that cannot be a response: every page, every attachment,
 * packed into one archive. So it is a row in `jobs`, this runs it, and the
 * result is a key in the file store that the person who asked can fetch.
 *
 * **It runs with the rights of whoever asked, as they are when it runs** — not
 * as they were when they asked. Both are defensible and this one is safer: a
 * job that captured somebody's access and then handed them a page they had lost
 * access to in the meantime would be a permission change that did not take
 * effect. The consequence is honest and worth stating in the interface: an
 * export can contain less than somebody expected, and never more.
 */

import type { Pool } from 'pg';

import { queryOne } from '../db/pool.js';
import type { FileStore } from '../files/store.js';
import type { Job, JobContext } from '../jobs/runner.js';
import { buildArchive } from './build.js';

export const WORKSPACE_EXPORT = 'workspace_export';

/** How many pages one workspace archive may hold. */
export const MAX_WORKSPACE_PAGES = 5000;

export function workspaceExportHandler(pool: Pool, store: FileStore) {
  return async (
    job: Job,
    ctx: JobContext,
  ): Promise<{ result: Record<string, unknown> }> => {
    await ctx.report('reading the workspace');

    // The asker's role now. A job whose creator has left the workspace exports
    // nothing rather than everything, which is the failure direction to choose.
    const membership = job.createdBy
      ? await queryOne<{ role: string }>(
          pool,
          `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
          [job.workspaceId, job.createdBy],
        )
      : null;
    if (!membership) throw new Error('the person who asked is no longer a member');

    const archive = await buildArchive(pool, store, {
      workspaceId: job.workspaceId,
      rootId: null,
      viewer: {
        userId: job.createdBy,
        isWorkspaceAdmin: membership.role === 'owner' || membership.role === 'admin',
      },
      withAttachments: job.payload['attachments'] !== false,
      maxPages: MAX_WORKSPACE_PAGES,
      report: ctx.report,
    });

    // Into the file store, not the database: an archive is a file, and a bytea
    // column holding a workspace is a backup nobody chose to take.
    const stored = await store.put(archive.bytes, 'zip');

    return {
      result: {
        key: stored.key,
        bytes: stored.sizeBytes,
        pages: archive.pages,
        attachments: archive.attachments,
      },
    };
  };
}
