/**
 * SONE server — invitations over HTTP.
 *
 * The domain layer has had invitations since the authentication work and
 * nothing ever exposed them: they could be created and accepted only from
 * inside the process, so in practice the only way into a workspace was to be
 * there when it was made.
 *
 * Two kinds, per ADR-0025. An invitation naming a workspace adds somebody to
 * it; one naming none creates an account and nothing else.
 */

import type { Pool } from 'pg';

import type { Router } from '../http/router.js';
import { roleIn } from './claims.js';
import { queryOne, queryRows } from '../db/pool.js';
import {
  addressLocale,
  recipientLocale,
  type SupportedLocale,
} from '../i18n/locale.js';
import type { Letter } from '../mail/letter.js';
import { words, type AddressForm, type Say } from '../mail/words.js';
import { requireSession } from '../http/auth.js';
import { holdsRight } from './rights.js';
import { AuthError } from './password.js';
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitations,
  revokeInvitation,
} from './registration.js';

export interface InvitationDeps {
  pool: Pool;
  /** Absent when the instance has no relay: the mail is then not sent. */
  sendLetter?: SendLetter;
  /** Where SONE lives, for the links a letter carries. */
  baseUrl?: string;
  /**
   * What this instance calls itself, for the subject lines.
   *
   * A function, because the name is a setting an administrator may change while
   * SONE runs — the same shape `main.ts` passes everywhere else it is needed.
   */
  instanceName?: () => Promise<string>;
  /**
   * How this instance addresses people — „du" or „Sie" (ADR-0133).
   *
   * A function for the same reason `instanceName` is one: it is a setting, and
   * a letter built from a value read at startup would keep the old address
   * until the process restarted.
   */
  addressForm?: () => Promise<AddressForm>;
}

/**
 * A letter's language and the voice that writes it (ADR-0133).
 *
 * Carried together because they always travel together: the `Letter` needs the
 * locale for its `lang` attribute, and every sentence in it needs the bound
 * catalogue. Passing only the `say` would leave the structure's own locale to
 * be worked out a second time, which is where the two would drift apart.
 */
interface Voice {
  say: Say;
  locale: SupportedLocale;
}

/** For somebody with an account: their language, then the workspace's. */
async function voiceFor(
  deps: InvitationDeps,
  userId: string,
  workspaceId?: string | null,
): Promise<Voice> {
  const locale = await recipientLocale(deps.pool, userId, workspaceId);
  return { locale, say: words(locale, (await deps.addressForm?.()) ?? 'informal') };
}

/** For a mailbox: an account with that address if there is one, then the place. */
async function voiceForAddress(
  deps: InvitationDeps,
  email: string,
  workspaceId?: string | null,
): Promise<Voice> {
  const locale = await addressLocale(deps.pool, email, workspaceId);
  return { locale, say: words(locale, (await deps.addressForm?.()) ?? 'informal') };
}

/**
 * May this person administer this workspace?
 *
 * Two ways to be able to: owner or admin *of it*, or holding the instance-wide
 * right to manage workspaces (ADR-0027). Asked in one place, because the second
 * way arrived after the first and every route that forgot it would be a route
 * where the right silently does not work.
 */
/**
 * Telling somebody, when there is a relay (ADR-0121).
 *
 * Injected rather than reached for, like `sendResetMail` beside it: this module
 * does not know about SMTP, and a test can watch what would have been sent
 * without one. Absent means no relay is configured — the mail is then *absent*
 * rather than broken, which is ADR-0059's rule for the reset link and the same
 * rule here.
 *
 * Every caller treats a failure as a courtesy not delivered, never as the act
 * failing: somebody was added to the workspace whether or not their mailbox
 * accepted a message about it. What the caller does say is `mailed: false`, so
 * the screen can offer the link to pass on by hand instead of implying one was
 * sent.
 */
export type SendLetter = (to: string, letter: Letter) => Promise<void>;

async function mayAdminister(
  pool: Pool,
  ctx: Parameters<typeof requireSession>[1],
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  // `people.manage` rather than "owner or admin" (ADR-0087). Both ways of
  // holding it — the role, and the instance-wide right — are asked inside
  // `holdsRight`, which is where ADR-0027's consolidation now lives.
  const { member, held } = await holdsRight(pool, workspaceId, userId, 'people.manage');
  if (held) return true;

  // Not found rather than forbidden for a workspace somebody is not in: "you
  // may not invite here" confirms the workspace exists.
  ctx.fail(member ? 403 : 404, member ? 'forbidden' : 'not_found');
  return false;
}

/**
 * The role a request names, whichever way it names it (ADR-0103).
 *
 * Two routes put a role on somebody — giving access and changing a member's —
 * and until now only the second could name a role this workspace defined. The
 * first offered three words, so letting a colleague in as "Redaktion" meant
 * adding them as a **member** (which is `editor` on every page here) and moving
 * them afterwards: an intermediate grant nobody asked for, as a required step.
 *
 * One function, because the alternative is the shape this repository keeps
 * removing from itself — the same question answered in two places, and answered
 * differently the day one of them grows a condition (ADR-0086).
 *
 * Fails the request itself, like `mayAdminister` above: every caller's answer
 * to "this role is not usable here" is the same 422, and a caller that has to
 * remember to write it is a caller that forgets.
 */
async function chooseRole(
  pool: Pool,
  ctx: Parameters<typeof requireSession>[1],
  workspaceId: string,
  body: { role?: unknown; roleId?: unknown },
): Promise<{ id: string; key: string | null; name: string } | null> {
  /*
   * Both spellings, rather than only ids: `role` is what every existing client
   * sends and what a share of the tests assert, and the four words are still
   * the names of real rows. A request naming both is answered as invalid rather
   * than picking one — two answers to "what should this person be" is not a
   * thing to guess at.
   */
  const word = typeof body.role === 'string' ? body.role : '';
  const roleId = typeof body.roleId === 'string' && body.roleId !== '' ? body.roleId : '';
  if (word !== '' && roleId !== '') {
    ctx.fail(422, 'invalid_role');
    return null;
  }
  if (word !== '' && !['owner', 'admin', 'member', 'guest'].includes(word)) {
    ctx.fail(422, 'invalid_role');
    return null;
  }

  const chosen = await queryOne<{ id: string; key: string | null; name: string }>(
    pool,
    roleId !== ''
      ? // A system role or one of this workspace's own — the same bound the
        // group route states: anything else would be another workspace's rule
        // reaching in here.
        `SELECT id, key, name FROM roles
          WHERE id = $1 AND (workspace_id IS NULL OR workspace_id = $2)`
      : `SELECT id, key, name FROM roles WHERE key = $1 AND workspace_id IS NULL`,
    roleId !== '' ? [roleId, workspaceId] : [word],
  );
  if (!chosen) {
    ctx.fail(422, 'invalid_role');
    return null;
  }
  return chosen;
}

/**
 * The four letters this module sends (ADR-0121, ADR-0128).
 *
 * They were English only, under a note saying that was a gap rather than a
 * decision, because *„neither of these has an account with a language on it"*.
 * **Half of that was wrong** (ADR-0133): three of the four go to somebody this
 * instance already has a row for — `tellAbout` is handed their user id — so
 * their language was one column away the whole time. Only the invitation goes
 * to a mailbox with no account behind it, and even there an address is not the
 * same thing as no account: a colleague being invited to a second workspace has
 * one, and `addressLocale` asks.
 */
function invitationLetter(
  deps: InvitationDeps,
  voice: Voice,
  where: string,
  token: string,
  expiresAt: Date,
): Letter {
  const base = deps.baseUrl ?? '';
  const days = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 86_400_000));
  return {
    subject: voice.say('invitation.subject', { where }),
    heading: voice.say('invitation.heading', { where }),
    lines: [{ text: voice.say('invitation.body') }, { text: voice.say('invitation.expires', { days }) }],
    action: { label: voice.say('invitation.action'), url: `${base}/signup?token=${token}` },
    footer: [voice.say('invitation.footer')],
    baseUrl: base,
    locale: voice.locale,
  };
}

function accessLetter(
  deps: InvitationDeps,
  voice: Voice,
  where: string,
  about: { workspace: string; by: string | null; role: string },
): Letter {
  const base = deps.baseUrl ?? '';
  return {
    subject: voice.say('access.subject', { where, workspace: about.workspace }),
    heading: voice.say('access.heading', { workspace: about.workspace }),
    lines: [
      {
        // Two sentences, not one with a name in front of it: a language that
        // cannot put a subject before its passive needs the whole sentence to
        // change, which is why there are two keys rather than a prefix.
        text: about.by
          ? voice.say('access.by', { by: about.by, role: about.role })
          : voice.say('access.anon', { role: about.role }),
      },
      { text: voice.say('access.nothing') },
    ],
    action: { label: voice.say('access.action'), url: base },
    baseUrl: base,
    locale: voice.locale,
  };
}

/**
 * The other half of being let in (ADR-0128).
 *
 * `accessLetter` says "you can now work in X". These two say the opposite, and
 * they are the more important ones: gaining access shows up as a workspace
 * appearing, while losing it shows up as a bookmark that stops working — and
 * the first guess is that something is broken rather than that something was
 * decided.
 *
 * **Who and where, never what** (ADR-0058) holds exactly as it does above: the
 * workspace's name is where, and a list of what they can no longer see would be
 * the content leaving along with the access.
 */
function removalLetter(
  deps: InvitationDeps,
  voice: Voice,
  where: string,
  about: { workspace: string; by: string | null },
): Letter {
  const base = deps.baseUrl ?? '';
  return {
    subject: voice.say('removal.subject', { where, workspace: about.workspace }),
    heading: voice.say('removal.heading', { workspace: about.workspace }),
    lines: [
      { text: about.by ? voice.say('removal.by', { by: about.by }) : voice.say('removal.anon') },
      { text: voice.say('removal.gone') },
    ],
    // No action, deliberately: there is nothing left for them to open, and a
    // button here would lead to the 404 this letter exists to explain.
    baseUrl: base,
    locale: voice.locale,
  };
}

function roleChangeLetter(
  deps: InvitationDeps,
  voice: Voice,
  where: string,
  about: { workspace: string; by: string | null; role: string },
): Letter {
  const base = deps.baseUrl ?? '';
  return {
    subject: voice.say('role.subject', { where, workspace: about.workspace }),
    heading: voice.say('role.heading', { role: about.role, workspace: about.workspace }),
    lines: [
      { text: about.by ? voice.say('role.by', { by: about.by }) : voice.say('role.anon') },
      { text: voice.say('role.mayDiffer') },
    ],
    action: { label: voice.say('role.action'), url: base },
    baseUrl: base,
    locale: voice.locale,
  };
}

/**
 * Tell somebody what happened to their access, if there is anybody to tell.
 *
 * Three reasons there may not be, and all three are ordinary rather than
 * errors: no relay on this instance (ADR-0059), an account with no address at
 * all — a guest (ADR-0033) — and **the actor acting on their own row**, because
 * somebody who just pressed the button knows what they did. A confirmation for
 * every act is what teaches people to filter mail from this instance, which is
 * what would then hide the letter that matters.
 *
 * A failed send never undoes the act, the rule ADR-0121 states: they have lost
 * the access whether or not their mailbox took a message about it.
 */
async function tellAbout(
  deps: InvitationDeps,
  actorId: string,
  targetId: string,
  workspaceId: string | null,
  build: (voice: Voice, where: string, to: { display_name: string }) => Letter,
): Promise<void> {
  if (!deps.sendLetter || actorId === targetId) return;

  const target = await queryOne<{ email: string | null }>(
    deps.pool,
    `SELECT email FROM users WHERE id = $1`,
    [targetId],
  );
  if (!target?.email) return;

  const actor = await queryOne<{ display_name: string }>(
    deps.pool,
    `SELECT display_name FROM users WHERE id = $1`,
    [actorId],
  );

  /*
   * **The target's language, never the actor's** (ADR-0133).
   *
   * The line `recipientLocale` was written for: a German administrator taking
   * away a French colleague's access sends a French letter. Getting this the
   * other way round would be a mail that is easier for the person who does not
   * have to read it.
   */
  const voice = await voiceFor(deps, targetId, workspaceId);

  await deps
    .sendLetter(
      target.email,
      build(voice, deps.instanceName ? await deps.instanceName() : 'SONE', {
        display_name: actor?.display_name ?? '',
      }),
    )
    .catch(() => undefined);
}

export function registerInvitationRoutes(router: Router, deps: InvitationDeps): void {
  /**
   * What a token is for, before anybody commits to it.
   *
   * Unauthenticated, because it is read on the sign-up page by somebody who has
   * no account yet. It says the workspace's name and whether an address is
   * required — never who invited whom, and never the address itself, which
   * would make a guessed token a way to harvest one.
   */
  router.get('/api/invitations/:token', async (ctx) => {
    const invitation = await inspectInvitation(deps.pool, ctx.params['token'] ?? '');
    if (!invitation) {
      ctx.fail(404, 'invalid_invitation');
      return;
    }

    ctx.send(200, {
      workspaceName: invitation.workspaceName,
      /** An invitation to the instance alone has no workspace to name. */
      instanceOnly: invitation.workspaceId === null,
      needsAddress: invitation.email !== null,
    });
  });

  /** Accept it as somebody who already has an account. */
  router.post('/api/invitations/:token/accept', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    try {
      const result = await acceptInvitation(deps.pool, {
        token: ctx.params['token'] ?? '',
        userId: user.userId,
      });
      ctx.send(200, result);
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        ctx.fail(400, error.code);
        return;
      }
      throw error;
    }
  });

  /**
   * Find the person you mean, before adding them (ADR-0119).
   *
   * Reported as: typing an address gives no sign whether it worked or whether
   * it is the right person — *„beim Eingeben der Email ist es nicht intuitiv ob
   * es auch wirklich geklappt hat und ob es die richtige Person ist"*. The form
   * took an address, and the answer arrived after the button, as an error.
   *
   * ## This supersedes half of ADR-0073, which refused it
   *
   * > By address rather than from a list of everybody. An owner adding a
   * > colleague knows their address; a picker of every account on the server
   * > would turn every workspace owner into a reader of the instance's
   * > directory, which is a right the administration keeps on purpose
   * > (ADR-0032).
   *
   * The concern is right and the conclusion was too strong, for a reason
   * written twenty lines below it: the adding route already answers
   * `no_such_account` for any address given, *plainly*, "because the people who
   * can ask this question are the ones already trusted with who is in the
   * workspace". Address → account was therefore never protected from this
   * caller. What is genuinely new here is **name → address**, which is why this
   * takes the same right and not a looser one.
   *
   * **Two characters, and nothing without them.** That is the whole difference
   * between confirming a person and listing the instance: with no query there
   * are no results, so this is never a directory being read — it is an answer
   * to a name somebody already has in mind. A determined caller could still
   * walk prefixes; the honest statement is that this makes the directory
   * *awkward* to enumerate rather than impossible, and that the caller could
   * already do it one address at a time.
   *
   * **Somebody already here is returned and marked**, not filtered out. Hidden,
   * they read as "no such person" — which is the same confusion this round is
   * fixing, arriving from the other side. `already_member` is what the adding
   * route says; this is that answer moved to before the click.
   */
  router.get('/api/workspaces/:workspaceId/people', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    const query = (ctx.url.searchParams.get('q') ?? '').trim();
    // Two, and an empty answer rather than a refusal: somebody who has typed
    // one letter is mid-word, not in error.
    if (query.length < 2) {
      ctx.send(200, { people: [] });
      return;
    }

    const rows = await queryRows<{
      id: string;
      display_name: string;
      email: string;
      member: boolean;
    }>(
      deps.pool,
      // The same two exclusions the adding route makes, for the same reasons: a
      // share-link guest has no account of their own, and an account that has
      // been turned off must not be brought back by adding it somewhere.
      //
      // `ILIKE '%…%'` on the name and the address. A prefix match would be
      // cheaper and would miss a surname, which is what half of a search for a
      // person is.
      `SELECT u.id, u.display_name, u.email,
              EXISTS (
                SELECT 1 FROM workspace_members m
                 WHERE m.workspace_id = $2 AND m.user_id = u.id
              ) AS member
         FROM users u
        WHERE NOT u.is_guest AND u.disabled_at IS NULL
          AND (u.display_name ILIKE $1 OR u.email ILIKE $1)
        ORDER BY u.display_name, u.email
        LIMIT 8`,
      // Escaped, or a name with a percent sign in it matches everybody — which
      // is the listing this route exists not to be.
      [`%${query.replace(/[\\%_]/g, (one) => `\\${one}`)}%`, workspaceId],
    );

    ctx.send(200, {
      people: rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        // Beside the name rather than instead of it: a name is what somebody
        // recognises, and an address is what tells two people of one name apart.
        email: row.email,
        member: row.member,
      })),
    });
  });

  /**
   * Give an account that already exists access to a workspace (ADR-0073).
   *
   * This replaces inviting somebody to a workspace, and the two were being
   * confused because one form did both jobs. They are different jobs. An
   * invitation makes an *account* — a person who is not on this server yet — and
   * that belongs to whoever runs the server. Access says which of the people
   * already here may work in this workspace, and that belongs to whoever owns
   * the workspace.
   *
   * By address rather than from a list of everybody. An owner adding a
   * colleague knows their address; a picker of every account on the server
   * would turn every workspace owner into a reader of the instance's directory,
   * which is a right the administration keeps on purpose (ADR-0032).
   *
   * Owners and admins only, like every other change to who is here: a member
   * who could add people could add somebody with more rights than themselves,
   * and a workspace where anybody can widen the membership is not one whose
   * membership means anything.
   */
  router.post('/api/workspaces/:workspaceId/members', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    let body: { email?: unknown; role?: unknown; roleId?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email === '') {
      ctx.fail(422, 'invalid_email');
      return;
    }

    /*
     * Any role this workspace can use, not three words (ADR-0103).
     *
     * It offered `admin | member | guest` and quietly fell back to `member` for
     * anything else — so letting somebody in as a role this workspace defined
     * was impossible, and the way round it was to add them as a member and
     * change it afterwards. A member is `editor` on every page here, so the
     * workaround grants write access to somebody who was meant to have less,
     * for as long as it takes to make the second request.
     *
     * Falling back is gone with it. A named role the server does not recognise
     * is refused, for the reason the roles screen refuses an unknown right
     * (ADR-0087): a request that asked for one thing and quietly got another is
     * how a permission comes to half-work.
     */
    const chosen = await chooseRole(deps.pool, ctx, workspaceId, {
      // The default lives here rather than in the resolver, because the other
      // caller has no default: changing somebody's role to nothing in
      // particular is not a thing to interpret.
      role: body.role === undefined && body.roleId === undefined ? 'member' : body.role,
      roleId: body.roleId,
    });
    if (!chosen) return;

    /*
     * Owner is still not on offer (ADR-0073).
     *
     * "A second owner is a decision about who may delete the workspace. It
     * stays a separate act on the row." It used to be refused by not appearing
     * in a list of three, which is a refusal by omission — and accepting an id
     * would have been a second door to the same room, opened by this change
     * and by nothing that names it.
     */
    if (chosen.key === 'owner') {
      ctx.fail(422, 'invalid_role');
      return;
    }

    /*
     * A real account, in use.
     *
     * `is_guest` marks somebody who arrived through a share link and has no
     * account of their own; a disabled one is an account that has been turned
     * off, and turning it off must not be undone by adding it somewhere.
     */
    const account = await queryOne<{ id: string }>(
      deps.pool,
      `SELECT id FROM users
        WHERE lower(email) = $1 AND NOT is_guest AND disabled_at IS NULL`,
      [email],
    );
    if (!account) {
      // Said plainly rather than hidden. The alternative — the same answer for
      // "no such account" and "added" — would leave an owner unable to tell a
      // typo from a success, and the people who can ask this question are the
      // ones already trusted with who is in the workspace.
      ctx.fail(404, 'no_such_account');
      return;
    }

    const already = await roleIn(deps.pool, workspaceId, account.id);
    if (already) {
      // Not a silent role change: "add" and "promote" are different acts, and
      // the second one has a control of its own in the same table.
      ctx.fail(409, 'already_member');
      return;
    }

    // One statement, one role. `is_owner` is written false rather than derived,
    // because the refusal above is what decides it and a second expression
    // deciding it again is a second place to be wrong.
    await deps.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
       VALUES ($1,$2,$3,false)`,
      [workspaceId, account.id, chosen.id],
    );
    // The row, named the way the members listing names it: `key` for one of the
    // four, `'custom'` for a role this workspace made, and its own name beside
    // it because a custom role has no word to translate.
    /*
     * And tell them (ADR-0121).
     *
     * *„Hinzufügen zu Workspace per Email an das neue Mitglied bestätigen, da
     * wäre dann ja nichts zu tun, aber eine Info per Mail macht Sinn."* — so it
     * is an announcement and not a request: no token, no link to accept,
     * nothing to press. The place, who let them in, and the way there.
     */
    const where = await queryOne<{ name: string }>(
      deps.pool,
      `SELECT name FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    const inviter = await queryOne<{ display_name: string }>(
      deps.pool,
      `SELECT display_name FROM users WHERE id = $1`,
      [user.userId],
    );
    if (deps.sendLetter) {
      await deps
        .sendLetter(
          email,
          accessLetter(
            deps,
            await voiceFor(deps, account.id, workspaceId),
            deps.instanceName ? await deps.instanceName() : 'SONE',
            {
              workspace: where?.name ?? '',
              by: inviter?.display_name ?? null,
              role: chosen.name,
            },
          ),
        )
        // Swallowed: they have the access whether or not their mailbox took a
        // message about it, and failing the request would be undoing a grant
        // that succeeded.
        .catch(() => undefined);
    }

    ctx.send(201, {
      userId: account.id,
      role: chosen.key ?? 'custom',
      roleId: chosen.id,
      roleName: chosen.name,
    });
  });

  /**
   * Outstanding invitations to the instance.
   *
   * The counterpart of the workspace listing above, and the reason it exists: an
   * invitation that cannot be seen cannot be withdrawn, so a link sent to the
   * wrong address stayed valid for as long as it lived and nobody could tell.
   */
  router.get('/api/admin/invitations', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const admin = await queryOne<{ is_instance_admin: boolean }>(
      deps.pool,
      `SELECT is_instance_admin FROM users WHERE id = $1`,
      [user.userId],
    );
    if (admin?.is_instance_admin !== true) {
      ctx.fail(403, 'forbidden');
      return;
    }

    // Null: the invitations that name no workspace.
    ctx.send(200, { invitations: await listInvitations(deps.pool, null) });
  });

  /**
   * Invite somebody to the instance and nowhere else.
   *
   * The thing that could not be expressed before: an account, and their own
   * workspace, without a decision about which team they belong to.
   */
  router.post('/api/admin/invitations', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const admin = await queryOne<{ is_instance_admin: boolean }>(
      deps.pool,
      `SELECT is_instance_admin FROM users WHERE id = $1`,
      [user.userId],
    );
    if (admin?.is_instance_admin !== true) {
      ctx.fail(403, 'forbidden');
      return;
    }

    let body: { email?: unknown; maxUses?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const invitation = await createInvitation(deps.pool, {
      workspaceId: null,
      invitedBy: user.userId,
      email: typeof body.email === 'string' ? body.email : null,
      ...(typeof body.maxUses === 'number' ? { maxUses: body.maxUses } : {}),
    });

    /*
     * And send it, when there is somewhere to send it to (ADR-0121).
     *
     * Until now this route made a link and handed it back, and an administrator
     * copied it into a mail of their own — *„Einladung Versand an neue Team
     * Mitglieder per Email"*. An invitation with no address on it is still a
     * link to pass on by hand; that case is unchanged.
     *
     * `mailed` is reported rather than assumed. A failure here is a courtesy
     * not delivered and never the invitation failing — it exists, it works, and
     * the screen can offer the link instead of implying a mail arrived.
     */
    const to = typeof body.email === 'string' ? body.email.trim() : '';
    const mailed =
      to === '' || !deps.sendLetter
        ? false
        : await deps
            .sendLetter(
              to,
              invitationLetter(
                deps,
                /*
                 * Nobody has an account yet, usually — but "usually" is not
                 * "never": a colleague being invited has one, with a language
                 * on it (ADR-0133).
                 *
                 * And no workspace to fall back to, because this route is the
                 * invitation to the *instance* — so somebody genuinely unknown
                 * gets English, which is the honest end of the order rather
                 * than a gap.
                 */
                await voiceForAddress(deps, to, null),
                deps.instanceName ? await deps.instanceName() : 'SONE',
                invitation.token,
                invitation.expiresAt,
              ),
            )
            .then(() => true)
            .catch(() => false);

    ctx.send(201, {
      token: invitation.token,
      invitationId: invitation.invitationId,
      expiresAt: invitation.expiresAt,
      mailed,
    });
  });

  /** What is outstanding, so an administrator can see and withdraw them. */
  router.get('/api/workspaces/:workspaceId/invitations', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    ctx.send(200, { invitations: await listInvitations(deps.pool, workspaceId) });
  });

  /**
   * Change what somebody may do in a workspace.
   *
   * Here rather than in workspaces.ts because it is the same question those
   * routes ask — who may administer this workspace — and answering it in two
   * files is how the instance-wide right ends up working in one and not the
   * other.
   */
  router.put('/api/workspaces/:workspaceId/members/:userId', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    let body: { role?: unknown; roleId?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const target = ctx.params['userId'] ?? '';

    // One of the four words, or the id of a role this workspace defined
    // (ADR-0087), resolved the same way the route above resolves it
    // (ADR-0103). A custom role never carries ownership: that is a column on
    // the membership, so "a workspace keeps an owner" stays one query.
    const chosen = await chooseRole(deps.pool, ctx, workspaceId, body);
    if (!chosen) return;
    const role = chosen.key;

    const current = await roleIn(deps.pool, workspaceId, target);
    if (!current) {
      ctx.fail(404, 'not_found');
      return;
    }

    // A workspace keeps an owner.
    //
    // Demoting the last one leaves a workspace nobody can transfer or delete,
    // and the person who did it is usually the person who then cannot undo it.
    //
    // Counted over `is_owner`, the column, rather than over the role word:
    // ownership is not a right and does not travel with a role, precisely so
    // that this rule stays one query instead of "the last person holding a
    // role that includes deletion" (ADR-0087).
    if (current === 'owner' && role !== 'owner') {
      const others = await queryOne<{ n: number }>(
        deps.pool,
        `SELECT count(*)::int AS n FROM workspace_members
          WHERE workspace_id = $1 AND is_owner AND user_id <> $2`,
        [workspaceId, target],
      );
      if ((others?.n ?? 0) === 0) {
        ctx.fail(409, 'last_owner');
        return;
      }
    }

    /*
     * What they hold now, read before the write (ADR-0128).
     *
     * A role set to the one somebody already has is not a change, and telling
     * them about it is the saving-a-form case: an administrator opens the
     * members screen, presses save, and everybody gets a letter about nothing.
     */
    const held = await queryOne<{ role_id: string }>(
      deps.pool,
      `SELECT role_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, target],
    );

    await deps.pool.query(
      /*
       * The row, and ownership beside it. The enum column is gone (ADR-0102).
       *
       * It used to be written here too, "kept in step so a rolled-back release
       * still sees something sensible" — and because it cannot name a custom
       * role, assigning one wrote the word `member`. Two live listings then
       * read that word and told the person they were a member.
       */
      `UPDATE workspace_members
          SET role_id = $3,
              is_owner = ($4 = 'owner')
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, target, chosen.id, role ?? ''],
    );

    if (held?.role_id !== chosen.id) {
      const where = await queryOne<{ name: string }>(
        deps.pool,
        `SELECT name FROM workspaces WHERE id = $1`,
        [workspaceId],
      );
      await tellAbout(deps, user.userId, target, workspaceId, (voice, instance, actor) =>
        roleChangeLetter(deps, voice, instance, {
          workspace: where?.name ?? '',
          by: actor.display_name || null,
          role: chosen.name,
        }),
      );
    }

    ctx.send(200, { ok: true });
  });

  /** Remove somebody from a workspace. */
  router.delete('/api/workspaces/:workspaceId/members/:userId', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    if (!(await mayAdminister(deps.pool, ctx, workspaceId, user.userId))) return;

    const target = ctx.params['userId'] ?? '';
    const current = await roleIn(deps.pool, workspaceId, target);
    if (!current) {
      ctx.fail(404, 'not_found');
      return;
    }

    if (current === 'owner') {
      // Over the column, for the reason above.
      const others = await queryOne<{ n: number }>(
        deps.pool,
        `SELECT count(*)::int AS n FROM workspace_members
          WHERE workspace_id = $1 AND is_owner AND user_id <> $2`,
        [workspaceId, target],
      );
      if ((others?.n ?? 0) === 0) {
        ctx.fail(409, 'last_owner');
        return;
      }
    }

    // Somebody's own workspace is not one they can be removed from. It exists
    // because they do (ADR-0025), and a personal workspace with no members is
    // a document store nobody can open.
    const personal = await queryOne<{ id: string }>(
      deps.pool,
      `SELECT id FROM workspaces WHERE id = $1 AND personal_for = $2`,
      [workspaceId, target],
    );
    if (personal) {
      ctx.fail(409, 'personal_workspace');
      return;
    }

    await deps.pool.query(
      `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, target],
    );

    // Page grants go with the membership. Left behind they would give access to
    // somebody who is no longer here — and reinstate it silently if they ever
    // rejoin.
    await deps.pool.query(
      `DELETE FROM page_permissions pp
        USING pages p
        WHERE pp.page_id = p.id AND p.workspace_id = $1 AND pp.user_id = $2`,
      [workspaceId, target],
    );
    await deps.pool.query(
      `DELETE FROM group_members gm
        USING groups g
        WHERE gm.group_id = g.id AND g.workspace_id = $1 AND gm.user_id = $2`,
      [workspaceId, target],
    );

    /*
     * And tell them (ADR-0128).
     *
     * The counterpart of the mail ADR-0121 sends when somebody is let in, and
     * the more important of the two: this one is otherwise discovered as a
     * bookmark that stops working.
     */
    const where = await queryOne<{ name: string }>(
      deps.pool,
      `SELECT name FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    await tellAbout(deps, user.userId, target, workspaceId, (voice, instance, actor) =>
      removalLetter(deps, voice, instance, {
        workspace: where?.name ?? '',
        by: actor.display_name || null,
      }),
    );

    ctx.send(200, { ok: true });
  });

  router.delete('/api/invitations/:invitationId', async (ctx) => {
    const user = await requireSession(deps.pool, ctx);
    if (!user) return;

    // Withdrawable by whoever could have created it: an admin of the workspace
    // it names, or an instance administrator for one that names none.
    const invitation = await queryOne<{ workspace_id: string | null }>(
      deps.pool,
      `SELECT workspace_id FROM invitations WHERE id = $1`,
      [ctx.params['invitationId'] ?? ''],
    );
    if (!invitation) {
      ctx.fail(404, 'not_found');
      return;
    }

    if (invitation.workspace_id) {
      /*
       * The right, like every other route in this file (ADR-0102).
       *
       * This one asked `role IN ('owner','admin')` on the enum column while its
       * four siblings asked `people.manage` — so somebody holding that right
       * through a custom role or a group could **create** an invitation and not
       * withdraw it. The comment defending the hand-written statement made a
       * case about SQL and none about the question being asked.
       *
       * Found by removing the column, which is the only reason anybody read
       * this line again.
       */
      if (!(await mayAdminister(deps.pool, ctx, invitation.workspace_id, user.userId))) return;
    } else {
      const admin = await queryOne<{ is_instance_admin: boolean }>(
        deps.pool,
        `SELECT is_instance_admin FROM users
          WHERE id = $1 AND is_instance_admin = true`,
        [user.userId],
      );
      if (!admin) {
        ctx.fail(403, 'forbidden');
        return;
      }
    }

    await revokeInvitation(deps.pool, ctx.params['invitationId'] ?? '');
    ctx.send(200, { ok: true });
  });
}
