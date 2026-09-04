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
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
        // No requirement in these suites (ADR-0065).
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
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

    // --- access, which is not an invitation (ADR-0073) ---------------------

    const addMember = (
      cookie: string,
      workspaceId: string,
      body: Record<string, unknown>,
    ): Promise<Response> =>
      fetch(`${base}/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });

    // Read from the table rather than from the listing route: this test server
    // registers the invitation routes and not the workspace ones, and asserting
    // through a route that is not mounted would be asserting nothing.
    const membersOf = async (workspaceId: string): Promise<string[]> => {
      const rows = await db.query<{ user_id: string }>(
        `SELECT user_id FROM workspace_members WHERE workspace_id = $1`,
        [workspaceId],
      );
      return rows.rows.map((one) => one.user_id);
    };

    test('somebody who already has an account is given access, not invited', async () => {
      /*
       * The two were one form and they are different jobs. An invitation makes
       * an *account*; access says which of the people already here may work in
       * this workspace. Somebody who exists does not need to be invented again.
       */
      const session = await setup();
      await signUp('colleague@example.org');

      const res = await addMember(session.cookie, session.workspaceId, {
        email: 'colleague@example.org',
        role: 'member',
      });
      const body = await expectJson<{ userId: string; role: string }>(res, 201);
      assert.equal(body.role, 'member');
      assert.ok((await membersOf(session.workspaceId)).includes(body.userId));

      // And nothing outstanding was created: there is no link, and nothing to
      // withdraw afterwards.
      assert.equal((await workspaceList(session.cookie, session.workspaceId)).length, 0);
    });

    test('the address has to belong to an account that exists', async () => {
      /*
       * Said plainly rather than hidden behind a success. The alternative would
       * leave an owner unable to tell a typo from a person who is now in the
       * workspace — and the people who may ask this question are already
       * trusted with who is here.
       */
      const session = await setup();
      const res = await addMember(session.cookie, session.workspaceId, {
        email: 'nobody@example.org',
      });
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: 'no_such_account' });
    });

    test('adding somebody twice is refused rather than silently promoting them', async () => {
      // "Add" and "promote" are different acts, and the second has a control of
      // its own in the same table.
      const session = await setup();
      await signUp('twice@example.org');
      await addMember(session.cookie, session.workspaceId, { email: 'twice@example.org' });

      const again = await addMember(session.cookie, session.workspaceId, {
        email: 'twice@example.org',
        role: 'admin',
      });
      assert.equal(again.status, 409);
      assert.deepEqual(await again.json(), { error: 'already_member' });
    });

    test('a member cannot let somebody else in', async () => {
      /*
       * Owners and admins only, like every other change to who is here: a
       * member who could add people could add somebody with more rights than
       * themselves.
       */
      const session = await setup();
      const other = await signUp('plain@example.org');
      const otherId = (
        await db.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
          'plain@example.org',
        ])
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [session.workspaceId, otherId],
      );
      await signUp('third@example.org');

      const res = await addMember(other, session.workspaceId, {
        email: 'third@example.org',
      });
      assert.equal(res.status, 403);
    });

    test('somebody outside the workspace is answered as if it did not exist', async () => {
      // Not found rather than forbidden: "you may not do this here" confirms
      // the workspace exists, which is the same rule its listing follows.
      const session = await setup();
      const other = await signUp('outsider@example.org');
      await signUp('target@example.org');

      const res = await addMember(other, session.workspaceId, {
        email: 'target@example.org',
      });
      assert.equal(res.status, 404);
    });

    test('a workspace can no longer produce an invitation of its own', async () => {
      /*
       * The route is gone (ADR-0073). Making an account is the instance's job,
       * and leaving a second door open would leave the confusion in place: two
       * forms, one of which quietly creates people on the server.
       */
      const session = await setup();
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/invitations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: session.cookie },
          body: JSON.stringify({ email: 'someone@example.org' }),
        },
      );
      assert.equal(res.status, 405);
    });
  },
);
