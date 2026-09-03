/**
 * Seeing and withdrawing invitations (ADR-0025).
 *
 * Both invitation forms produced a link and then forgot it. A workspace's
 * outstanding ones could be listed; the instance's could not be listed at all, so
 * a link sent to the wrong address stayed valid until it expired and nothing said
 * it existed.
 *
 * The two scopes are the same rows with one difference — whether the invitation
 * names a workspace — so these tests are mostly about not confusing them, and
 * about who may see and withdraw which.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { createInvitation } from '../src/auth/registration.js';
import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerInvitationRoutes } from '../src/auth/invitationRoutes.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

interface Pending {
  id: string;
  email: string | null;
  role: string;
  uses: number;
  maxUses: number;
  expiresAt: string;
}

describe(
  'outstanding invitations (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
        // No relay in these suites: the reset is absent, which is the
        // ordinary case for an instance without mail (ADR-0059).
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
      });
      registerInvitationRoutes(router, { pool: db });

      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
    });

    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header, 'expected a Set-Cookie header');
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    const auth = (cookie: string, init: RequestInit = {}): RequestInit => ({
      ...init,
      headers: { ...(init.headers ?? {}), cookie },
    });

    /** The first account, which is the instance administrator. */
    async function setup(): Promise<{
      cookie: string;
      workspaceId: string;
      userId: string;
    }> {
      const res = await fetch(
        `${base}/api/auth/setup`,
        json({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          workspaceName: 'Team',
        }),
      );
      const body = await expectJson<{ userId: string; workspaceId: string }>(res, 201);
      return { cookie: cookieFrom(res), workspaceId: body.workspaceId, userId: body.userId };
    }

    /** A second account, which administers nothing. */
    async function signUp(email: string): Promise<string> {
      const res = await fetch(
        `${base}/api/auth/signup`,
        json({ email, password: PASSWORD, displayName: 'Other' }),
      );
      await expectStatus(res, 201);
      return cookieFrom(res);
    }

    const instanceList = async (cookie: string): Promise<Pending[]> => {
      const res = await fetch(`${base}/api/admin/invitations`, auth(cookie));
      const body = await expectJson<{ invitations: Pending[] }>(res, 200);
      return body.invitations;
    };

    const workspaceList = async (cookie: string, workspaceId: string): Promise<Pending[]> => {
      const res = await fetch(
        `${base}/api/workspaces/${workspaceId}/invitations`,
        auth(cookie),
      );
      const body = await expectJson<{ invitations: Pending[] }>(res, 200);
      return body.invitations;
    };

    test('an invitation to the instance can be seen', async () => {
      // It could not be, at all: the listing was workspace-scoped, so the one
      // kind of invitation that names no workspace had nowhere to appear.
      const session = await setup();
      await createInvitation(db, {
        workspaceId: null,
        invitedBy: session.userId,
        email: 'newcomer@example.org',
      });

      const invitations = await instanceList(session.cookie);
      assert.equal(invitations.length, 1);
      assert.equal(invitations[0]?.email, 'newcomer@example.org');
      assert.equal(invitations[0]?.uses, 0);
      assert.equal(invitations[0]?.maxUses, 1, 'an addressed invitation is used once');
    });

    test('the two scopes do not see each other', async () => {
      // One difference between the rows — whether a workspace is named — and two
      // lists that must not blur it: an invitation into a team is not an
      // invitation to the instance, and showing one as the other would be a
      // permission claim that is simply untrue.
      const session = await setup();
      await createInvitation(db, {
        workspaceId: null,
        invitedBy: session.userId,
        email: 'instance@example.org',
      });
      await createInvitation(db, {
        workspaceId: session.workspaceId,
        invitedBy: session.userId,
        email: 'team@example.org',
      });

      assert.deepEqual(
        (await instanceList(session.cookie)).map((row) => row.email),
        ['instance@example.org'],
      );
      assert.deepEqual(
        (await workspaceList(session.cookie, session.workspaceId)).map((row) => row.email),
        ['team@example.org'],
      );
    });

    test('a link invitation says it is for anybody, by having no address', async () => {
      const session = await setup();
      await createInvitation(db, {
        workspaceId: null,
        invitedBy: session.userId,
        email: null,
        maxUses: 10,
      });

      const [invitation] = await instanceList(session.cookie);
      assert.equal(invitation?.email, null);
      assert.equal(invitation?.maxUses, 10);
    });

    test('withdrawing one takes it off the list', async () => {
      // The point of the whole change: an invitation that cannot be seen cannot
      // be withdrawn, and one sent to the wrong address stayed valid until it
      // expired.
      const session = await setup();
      const invitation = await createInvitation(db, {
        workspaceId: null,
        invitedBy: session.userId,
        email: 'mistake@example.org',
      });

      const res = await fetch(
        `${base}/api/invitations/${invitation.invitationId}`,
        auth(session.cookie, { method: 'DELETE' }),
      );
      await expectStatus(res, 200);

      assert.deepEqual(await instanceList(session.cookie), []);
    });

    test('a withdrawn or expired invitation is not listed', async () => {
      // The list is what somebody can still act on. A withdrawn one shown greyed
      // out is a row that invites the question of whether it still works.
      const session = await setup();
      const revoked = await createInvitation(db, {
        workspaceId: null,
        invitedBy: session.userId,
        email: 'revoked@example.org',
      });
      const expired = await createInvitation(db, {
        workspaceId: null,
        invitedBy: session.userId,
        email: 'expired@example.org',
      });

      await db.query(`UPDATE invitations SET revoked_at = now() WHERE id = $1`, [
        revoked.invitationId,
      ]);
      await db.query(
        `UPDATE invitations SET expires_at = now() - interval '1 day' WHERE id = $1`,
        [expired.invitationId],
      );

      assert.deepEqual(await instanceList(session.cookie), []);
    });

    test('somebody who does not administer the instance cannot see its invitations', async () => {
      const session = await setup();
      await createInvitation(db, {
        workspaceId: null,
        invitedBy: session.userId,
        email: 'secret@example.org',
      });

      const other = await signUp('other@example.org');
      const res = await fetch(`${base}/api/admin/invitations`, auth(other));
      await expectStatus(res, 403);
    });

    test('somebody outside a workspace cannot see its invitations', async () => {
      // Not found rather than forbidden: "you may not look here" confirms the
      // workspace exists.
      const session = await setup();
      const other = await signUp('other@example.org');
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/invitations`,
        auth(other),
      );
      await expectStatus(res, 404);
    });

    test('somebody outside cannot withdraw an invitation either', async () => {
      const session = await setup();
      const invitation = await createInvitation(db, {
        workspaceId: session.workspaceId,
        invitedBy: session.userId,
        email: 'team@example.org',
      });

      const other = await signUp('other@example.org');
      const res = await fetch(
        `${base}/api/invitations/${invitation.invitationId}`,
        auth(other, { method: 'DELETE' }),
      );
      await expectStatus(res, 403);

      // And it still works afterwards, which is the thing that would matter.
      assert.equal((await workspaceList(session.cookie, session.workspaceId)).length, 1);
    });
  },
);
