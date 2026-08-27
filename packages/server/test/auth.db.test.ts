/**
 * Auth and capability tests.
 *
 * The permission cases carry most of the weight here. A bug in the
 * materialiser produces a wrong view; a bug in `effectiveRole` hands a
 * stranger someone else's documents.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { DOC_KEYS, PAGE_KEYS, META_KEYS } from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { withTransaction } from '../src/db/pool.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import {
  AuthError,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../src/auth/password.js';
import {
  changePassword,
  createSession,
  listSessions,
  login,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  LOGIN_ATTEMPT_LIMIT,
} from '../src/auth/session.js';
import {
  bootstrapInstance,
  createInvitation,
  inspectInvitation,
  register,
  revokeInvitation,
} from '../src/auth/registration.js';
import {
  authorizeDocumentOpen,
  effectiveRole,
  loadPageLocation,
  resolveSessionClaims,
  resolveShareTokenClaims,
  type AccessClaims,
} from '../src/auth/claims.js';
import { createShareLink, listShareLinks, revokeShareLink } from '../src/auth/share.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

const PASSWORD = 'correct-horse-battery-staple';

describe('auth (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let fx: Fixture;

  before(async () => {
    db = await getTestPool();
  });
  after(async () => {
    await closeTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    fx = await seedWorkspace(db);
  });

  // --- helpers -------------------------------------------------------------

  async function makePage(
    id: string,
    opts: { title?: string; parentPageId?: string | null } = {},
  ): Promise<void> {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, opts.title ?? 'Page');
    page.set(PAGE_KEYS.idx, 'a0');
    page.set(PAGE_KEYS.parentPageId, opts.parentPageId ?? null);
    await withTransaction(db, (client) =>
      materializeYDoc(client, id, doc, { throughSeq: 1, workspaceId: fx.workspaceId }),
    );
  }

  async function makeUser(
    email: string,
    role: 'owner' | 'admin' | 'member' | 'guest' = 'member',
  ): Promise<string> {
    const hash = await hashPassword(PASSWORD);
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, email.split('@')[0], hash, role === 'guest'],
    );
    const userId = user.rows[0]!.id;
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)`,
      [fx.workspaceId, userId, role],
    );
    return userId;
  }

  // --- password hashing ----------------------------------------------------

  test('password round-trips and rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    assert.match(hash, /^scrypt\$/);
    assert.equal((await verifyPassword(PASSWORD, hash)).valid, true);
    assert.equal((await verifyPassword('wrong-password-entirely', hash)).valid, false);
  });

  test('identical passwords produce different hashes', async () => {
    // Salting, verified rather than assumed.
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    assert.notEqual(a, b);
  });

  test('unicode-equivalent passwords normalise to the same hash input', async () => {
    // 'é' as one codepoint vs 'e' + combining accent. Without NFKC a user who
    // set their password on one keyboard cannot log in from another.
    const composed = 'passwordé-long-enough';
    const decomposed = 'passworde\u0301-long-enough';
    const hash = await hashPassword(composed);
    assert.equal((await verifyPassword(decomposed, hash)).valid, true);
  });

  test('short passwords are refused', async () => {
    await assert.rejects(() => hashPassword('short'), AuthError);
  });

  test('a malformed stored hash fails closed', async () => {
    assert.equal((await verifyPassword(PASSWORD, 'garbage')).valid, false);
    assert.equal((await verifyPassword(PASSWORD, '')).valid, false);
    assert.equal((await verifyPassword(PASSWORD, 'bcrypt$x$y')).valid, false);
  });

  // --- sessions ------------------------------------------------------------

  test('login creates a resolvable session', async () => {
    await makeUser('alice@example.org');
    const session = await login(db, { email: 'alice@example.org', password: PASSWORD });

    const resolved = await resolveSession(db, session.token);
    assert.ok(resolved);
    assert.equal(resolved!.user.email, 'alice@example.org');
  });

  test('login is case-insensitive on the email', async () => {
    await makeUser('bob@example.org');
    const session = await login(db, { email: '  BOB@Example.ORG ', password: PASSWORD });
    assert.ok(await resolveSession(db, session.token));
  });

  test('the session token is never stored in plaintext', async () => {
    await makeUser('carol@example.org');
    const session = await login(db, { email: 'carol@example.org', password: PASSWORD });

    const rows = await db.query<{ token_hash: Buffer }>(`SELECT token_hash FROM sessions`);
    assert.equal(rows.rows.length, 1);
    assert.ok(
      rows.rows[0]!.token_hash.equals(hashToken(session.token)),
      'stored value must be the digest',
    );
    assert.ok(
      !rows.rows[0]!.token_hash.toString('utf8').includes(session.token),
      'plaintext must not appear',
    );
  });

  test('unknown email and wrong password are indistinguishable', async () => {
    await makeUser('dave@example.org');
    const wrongUser = await login(db, { email: 'nobody@example.org', password: PASSWORD })
      .then(() => null)
      .catch((e: AuthError) => e);
    const wrongPass = await login(db, { email: 'dave@example.org', password: 'nope-nope-nope' })
      .then(() => null)
      .catch((e: AuthError) => e);

    assert.ok(wrongUser instanceof AuthError);
    assert.ok(wrongPass instanceof AuthError);
    assert.equal(wrongUser.message, wrongPass.message);
    assert.equal(wrongUser.code, wrongPass.code);
  });

  test('repeated failures trigger the rate limit', async () => {
    await makeUser('erin@example.org');
    for (let i = 0; i < LOGIN_ATTEMPT_LIMIT; i++) {
      await login(db, { email: 'erin@example.org', password: 'wrong-password-here' }).catch(
        () => {},
      );
    }
    // Even the correct password is refused once the limit is hit.
    const err = await login(db, { email: 'erin@example.org', password: PASSWORD })
      .then(() => null)
      .catch((e: AuthError) => e);
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, 'rate_limited');
  });

  test('a successful login clears the failure ledger', async () => {
    await makeUser('frank@example.org');
    for (let i = 0; i < 3; i++) {
      await login(db, { email: 'frank@example.org', password: 'wrong-password-here' }).catch(
        () => {},
      );
    }
    await login(db, { email: 'frank@example.org', password: PASSWORD });
    const remaining = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auth_attempts WHERE succeeded = false`,
    );
    assert.equal(remaining.rows[0]!.n, '0');
  });

  test('a revoked session stops resolving', async () => {
    const userId = await makeUser('grace@example.org');
    const session = await createSession(db, userId);
    assert.ok(await resolveSession(db, session.token));

    await revokeSession(db, session.sessionId);
    assert.equal(await resolveSession(db, session.token), null);
  });

  test('an expired session stops resolving', async () => {
    const userId = await makeUser('heidi@example.org');
    const session = await createSession(db, userId);
    await db.query(`UPDATE sessions SET expires_at = now() - interval '1 day' WHERE id = $1`, [
      session.sessionId,
    ]);
    assert.equal(await resolveSession(db, session.token), null);
  });

  test('a disabled account stops resolving', async () => {
    const userId = await makeUser('ivan@example.org');
    const session = await createSession(db, userId);
    await db.query(`UPDATE users SET disabled_at = now() WHERE id = $1`, [userId]);
    assert.equal(await resolveSession(db, session.token), null);
  });

  test('changing the password revokes sibling sessions but keeps the current one', async () => {
    // The point of the feature: a password change after a suspected
    // compromise is worthless if the attacker's session survives.
    const userId = await makeUser('judy@example.org');
    const keep = await createSession(db, userId);
    const other = await createSession(db, userId);

    await changePassword(db, userId, PASSWORD, 'a-brand-new-password-here', keep.sessionId);

    assert.ok(await resolveSession(db, keep.token), 'current session must survive');
    assert.equal(await resolveSession(db, other.token), null, 'sibling must be revoked');
  });

  test('the session list marks the current session', async () => {
    const userId = await makeUser('ken@example.org');
    const a = await createSession(db, userId, { userAgent: 'Firefox' });
    await createSession(db, userId, { userAgent: 'Safari' });

    const sessions = await listSessions(db, userId, a.sessionId);
    assert.equal(sessions.length, 2);
    assert.equal(sessions.filter((s) => s.isCurrent).length, 1);
  });

  test('revokeAllSessions returns how many it revoked', async () => {
    const userId = await makeUser('leo@example.org');
    await createSession(db, userId);
    await createSession(db, userId);
    assert.equal(await revokeAllSessions(db, userId), 2);
  });

  // --- registration and invitations ---------------------------------------

  test('invite-mode registration requires an invitation', async () => {
    await assert.rejects(
      () =>
        register(db, 'invite', {
          email: 'new@example.org',
          password: PASSWORD,
          displayName: 'New',
        }),
      AuthError,
    );
  });

  test('registration with a valid invitation joins the workspace', async () => {
    const invite = await createInvitation(db, {
      workspaceId: fx.workspaceId,
      invitedBy: fx.userId,
      email: 'invited@example.org',
    });

    const result = await register(db, 'invite', {
      email: 'invited@example.org',
      password: PASSWORD,
      displayName: 'Invited',
      invitationToken: invite.token,
    });

    assert.equal(result.workspaceId, fx.workspaceId);
    const member = await db.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [fx.workspaceId, result.userId],
    );
    assert.equal(member.rows[0]!.role, 'member');
  });

  test('an email-bound invitation refuses a different address', async () => {
    const invite = await createInvitation(db, {
      workspaceId: fx.workspaceId,
      invitedBy: fx.userId,
      email: 'expected@example.org',
    });
    await assert.rejects(
      () =>
        register(db, 'invite', {
          email: 'someone-else@example.org',
          password: PASSWORD,
          displayName: 'Other',
          invitationToken: invite.token,
        }),
      AuthError,
    );
  });

  test('a single-use invitation cannot be used twice', async () => {
    const invite = await createInvitation(db, {
      workspaceId: fx.workspaceId,
      invitedBy: fx.userId,
      email: null,
      maxUses: 1,
    });

    await register(db, 'invite', {
      email: 'first@example.org',
      password: PASSWORD,
      displayName: 'First',
      invitationToken: invite.token,
    });

    await assert.rejects(
      () =>
        register(db, 'invite', {
          email: 'second@example.org',
          password: PASSWORD,
          displayName: 'Second',
          invitationToken: invite.token,
        }),
      AuthError,
    );
  });

  test('a multi-use link invitation admits several people', async () => {
    // The "invite the whole club" case.
    const invite = await createInvitation(db, {
      workspaceId: fx.workspaceId,
      invitedBy: fx.userId,
      email: null,
      maxUses: 3,
    });
    for (const name of ['a', 'b', 'c']) {
      await register(db, 'invite', {
        email: `${name}@example.org`,
        password: PASSWORD,
        displayName: name,
        invitationToken: invite.token,
      });
    }
    const members = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workspace_members WHERE workspace_id = $1`,
      [fx.workspaceId],
    );
    assert.equal(members.rows[0]!.n, '4', 'owner plus three invitees');
  });

  test('a revoked invitation stops working', async () => {
    const invite = await createInvitation(db, {
      workspaceId: fx.workspaceId,
      invitedBy: fx.userId,
      email: null,
    });
    await revokeInvitation(db, invite.invitationId);
    assert.equal(await inspectInvitation(db, invite.token), null);
  });

  test('an expired invitation stops working', async () => {
    const invite = await createInvitation(db, {
      workspaceId: fx.workspaceId,
      invitedBy: fx.userId,
      email: null,
      ttlDays: 1,
    });
    await db.query(`UPDATE invitations SET expires_at = now() - interval '1 day'`);
    assert.equal(await inspectInvitation(db, invite.token), null);
  });

  test('an invitation cannot grant ownership', async () => {
    await assert.rejects(
      () =>
        createInvitation(db, {
          workspaceId: fx.workspaceId,
          invitedBy: fx.userId,
          role: 'owner',
        }),
      AuthError,
    );
  });

  test('registering an existing address is refused', async () => {
    await makeUser('taken@example.org');
    await assert.rejects(
      () =>
        register(db, 'open', {
          email: 'taken@example.org',
          password: PASSWORD,
          displayName: 'Dup',
        }),
      AuthError,
    );
  });

  test('closed mode refuses registration entirely', async () => {
    await assert.rejects(
      () =>
        register(db, 'closed', {
          email: 'nope@example.org',
          password: PASSWORD,
          displayName: 'Nope',
        }),
      AuthError,
    );
  });

  test('bootstrap refuses once a workspace exists', async () => {
    // seedWorkspace already created one.
    await assert.rejects(
      () =>
        bootstrapInstance(db, {
          email: 'root@example.org',
          password: PASSWORD,
          displayName: 'Root',
          workspaceName: 'Second',
        }),
      AuthError,
    );
  });

  test('bootstrap creates owner and workspace on a fresh instance', async () => {
    await resetDatabase(db);
    const result = await bootstrapInstance(db, {
      email: 'root@example.org',
      password: PASSWORD,
      displayName: 'Root',
      workspaceName: 'My workspace',
    });
    assert.ok(result.workspaceId);
    const member = await db.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE user_id = $1`,
      [result.userId],
    );
    assert.equal(member.rows[0]!.role, 'owner');
  });

  // --- capability resolution ----------------------------------------------

  test('a member gets editor on workspace pages', async () => {
    const userId = await makeUser('member@example.org', 'member');
    const session = await createSession(db, userId);
    await makePage(uuid(1));

    const claims = await resolveSessionClaims(db, session.token, fx.workspaceId);
    assert.ok(claims);
    const page = await loadPageLocation(db, uuid(1));
    assert.equal(effectiveRole(claims!, page!), 'editor');
  });

  test('an admin gets admin on workspace pages', async () => {
    const userId = await makeUser('admin@example.org', 'admin');
    const session = await createSession(db, userId);
    await makePage(uuid(1));

    const claims = await resolveSessionClaims(db, session.token, fx.workspaceId);
    const page = await loadPageLocation(db, uuid(1));
    assert.equal(effectiveRole(claims!, page!), 'admin');
  });

  test('a guest with no grant gets nothing', async () => {
    // A guest is a member row, so resolution succeeds; access must not.
    const userId = await makeUser('guest@example.org', 'guest');
    const session = await createSession(db, userId);
    await makePage(uuid(1));

    const claims = await resolveSessionClaims(db, session.token, fx.workspaceId);
    assert.ok(claims, 'guest must resolve to claims');
    const page = await loadPageLocation(db, uuid(1));
    assert.equal(effectiveRole(claims!, page!), null, 'but authorise nothing');
  });

  test('a guest with an explicit page grant gets exactly that page', async () => {
    const userId = await makeUser('guest2@example.org', 'guest');
    const session = await createSession(db, userId);
    await makePage(uuid(1), { title: 'Granted' });
    await makePage(uuid(2), { title: 'Other' });

    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1, $2, 'editor', false, $3)`,
      [uuid(1), userId, fx.userId],
    );

    const claims = await resolveSessionClaims(db, session.token, fx.workspaceId);
    assert.equal(effectiveRole(claims!, (await loadPageLocation(db, uuid(1)))!), 'editor');
    assert.equal(effectiveRole(claims!, (await loadPageLocation(db, uuid(2)))!), null);
  });

  test('a non-member of the workspace resolves to no claims', async () => {
    const hash = await hashPassword(PASSWORD);
    const outsider = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id`,
      ['outsider@example.org', 'Outsider', hash],
    );
    const session = await createSession(db, outsider.rows[0]!.id);
    assert.equal(await resolveSessionClaims(db, session.token, fx.workspaceId), null);
  });

  test('claims never reach across workspaces', async () => {
    // The boundary that must never leak, even with a matching grant id.
    const other = await seedWorkspace(db, 'Other workspace');
    const userId = await makeUser('member2@example.org', 'admin');
    const session = await createSession(db, userId);

    const claims = await resolveSessionClaims(db, session.token, fx.workspaceId);
    const foreignPage = {
      id: uuid(77),
      workspaceId: other.workspaceId,
      ancestorIds: [],
    };
    assert.equal(effectiveRole(claims!, foreignPage), null);
  });

  // --- share links --------------------------------------------------------

  test('a share link grants its role to an anonymous visitor', async () => {
    await makePage(uuid(1), { title: 'Shared' });
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      role: 'editor',
    });

    const resolved = await resolveShareTokenClaims(db, link.token, {
      displayName: 'Visitor',
    });
    assert.ok(resolved);
    assert.equal(resolved!.passwordRequired, false);
    assert.equal(resolved!.claims.principal.kind, 'anonymous');
    assert.equal(resolved!.claims.workspaceRole, null);

    const page = await loadPageLocation(db, uuid(1));
    assert.equal(effectiveRole(resolved!.claims, page!), 'editor');
  });

  test('a share link covers the subtree, so new subpages stay reachable', async () => {
    // The bug this prevents: a shared link breaking as soon as somebody adds
    // a subpage.
    await makePage(uuid(1), { title: 'Root' });
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      role: 'viewer',
      includeSubtree: true,
    });

    // Subpage created after the link was issued.
    await makePage(uuid(2), { title: 'Added later', parentPageId: uuid(1) });

    const resolved = await resolveShareTokenClaims(db, link.token, {});
    const child = await loadPageLocation(db, uuid(2));
    assert.equal(effectiveRole(resolved!.claims, child!), 'viewer');
  });

  test('a link without subtree scope does not reach children', async () => {
    await makePage(uuid(1));
    await makePage(uuid(2), { parentPageId: uuid(1) });
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      includeSubtree: false,
    });

    const resolved = await resolveShareTokenClaims(db, link.token, {});
    assert.equal(effectiveRole(resolved!.claims, (await loadPageLocation(db, uuid(2)))!), null);
  });

  test('a share link cannot be used to open a page outside its scope', async () => {
    // Rule 1 of ADR-0006, tested directly.
    await makePage(uuid(1), { title: 'Shared' });
    await makePage(uuid(2), { title: 'Not shared' });
    const link = await createShareLink(db, { pageId: uuid(1), createdBy: fx.userId });

    const resolved = await resolveShareTokenClaims(db, link.token, {});
    await authorizeDocumentOpen(db, resolved!.claims, uuid(1));
    await assert.rejects(
      () => authorizeDocumentOpen(db, resolved!.claims, uuid(2)),
      AuthError,
    );
  });

  test('opening a nonexistent page is refused like an unauthorised one', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, { pageId: uuid(1), createdBy: fx.userId });
    const resolved = await resolveShareTokenClaims(db, link.token, {});

    const err = await authorizeDocumentOpen(db, resolved!.claims, uuid(999))
      .then(() => null)
      .catch((e: AuthError) => e);
    assert.ok(err instanceof AuthError);
    assert.match(err.message, /not authorised/, 'must not reveal that the page is absent');
  });

  test('a password-protected link reports the requirement, then accepts', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      password: 'a-shared-link-password',
    });

    const first = await resolveShareTokenClaims(db, link.token, {});
    assert.equal(first!.passwordRequired, true);
    assert.equal(first!.claims.grants.length, 0, 'no grant before the password');

    const second = await resolveShareTokenClaims(db, link.token, {
      password: 'a-shared-link-password',
    });
    assert.equal(second!.passwordRequired, false);
    assert.equal(second!.claims.grants.length, 1);
  });

  test('a wrong link password is refused', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      password: 'the-real-password',
    });
    await assert.rejects(
      () => resolveShareTokenClaims(db, link.token, { password: 'guessing-wrong' }),
      AuthError,
    );
  });

  test('revoking a link kills it and its anonymous sessions', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, { pageId: uuid(1), createdBy: fx.userId });
    const resolved = await resolveShareTokenClaims(db, link.token, {});
    assert.ok(resolved);

    await revokeShareLink(db, link.shareTokenId);

    assert.equal(await resolveShareTokenClaims(db, link.token, {}), null);
    const sessions = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM share_sessions WHERE share_token_id = $1`,
      [link.shareTokenId],
    );
    assert.equal(sessions.rows[0]!.n, '0', 'active sessions must die with the link');
  });

  test('an expired link stops resolving', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, {
      pageId: uuid(1),
      createdBy: fx.userId,
      expiresInDays: 1,
    });
    await db.query(`UPDATE share_tokens SET expires_at = now() - interval '1 day'`);
    assert.equal(await resolveShareTokenClaims(db, link.token, {}), null);
  });

  test('share links cannot grant admin', async () => {
    await makePage(uuid(1));
    await assert.rejects(
      () => createShareLink(db, { pageId: uuid(1), createdBy: fx.userId, role: 'admin' }),
      AuthError,
    );
  });

  test('an unknown share token resolves to null, not an error', async () => {
    assert.equal(await resolveShareTokenClaims(db, generateToken(), {}), null);
  });

  test('the share link list reports active session counts', async () => {
    await makePage(uuid(1));
    const link = await createShareLink(db, { pageId: uuid(1), createdBy: fx.userId });
    await resolveShareTokenClaims(db, link.token, { displayName: 'One' });
    await resolveShareTokenClaims(db, link.token, { displayName: 'Two' });

    const links = await listShareLinks(db, uuid(1));
    assert.equal(links.length, 1);
    assert.equal(links[0]!.activeSessions, 2);
  });

  test('an anonymous session is reused when its id is presented again', async () => {
    // Otherwise every reconnect creates a new presence participant and the
    // cursor list fills with ghosts.
    await makePage(uuid(1));
    const link = await createShareLink(db, { pageId: uuid(1), createdBy: fx.userId });

    const first = await resolveShareTokenClaims(db, link.token, { displayName: 'Same' });
    const sessionId = (first!.claims.principal as { sessionId: string }).sessionId;

    const second = await resolveShareTokenClaims(db, link.token, {
      displayName: 'Same',
      existingShareSessionId: sessionId,
    });
    assert.equal((second!.claims.principal as { sessionId: string }).sessionId, sessionId);

    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM share_sessions`,
    );
    assert.equal(count.rows[0]!.n, '1');
  });

  test('the highest applicable role wins when grants overlap', async () => {
    const userId = await makeUser('overlap@example.org', 'guest');
    const session = await createSession(db, userId);
    await makePage(uuid(1));
    await makePage(uuid(2), { parentPageId: uuid(1) });

    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'viewer',true,$3), ($4,$2,'editor',false,$3)`,
      [uuid(1), userId, fx.userId, uuid(2)],
    );

    const claims = await resolveSessionClaims(db, session.token, fx.workspaceId);
    assert.equal(effectiveRole(claims!, (await loadPageLocation(db, uuid(1)))!), 'viewer');
    assert.equal(
      effectiveRole(claims!, (await loadPageLocation(db, uuid(2)))!),
      'editor',
      'the more specific editor grant must win over the inherited viewer grant',
    );
  });

  test('effectiveRole is pure and needs no database', () => {
    const claims: AccessClaims = {
      principal: { kind: 'anonymous', sessionId: 's', displayName: 'V' },
      workspaceId: 'ws',
      workspaceRole: null,
      grants: [
        { scopePageId: 'root', includeSubtree: true, role: 'commenter', source: 'share_token' },
      ],
    };
    assert.equal(
      effectiveRole(claims, { id: 'child', workspaceId: 'ws', ancestorIds: ['root'] }),
      'commenter',
    );
    assert.equal(
      effectiveRole(claims, { id: 'elsewhere', workspaceId: 'ws', ancestorIds: [] }),
      null,
    );
  });
});
