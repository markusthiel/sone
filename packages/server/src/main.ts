/**
 * SONE — server entrypoint.
 *
 * Startup order matters and is deliberate:
 *
 *   1. Configuration, validated eagerly. A server that starts and then fails
 *      on the first upload because a variable was missing is worse than one
 *      that refuses to start.
 *   2. Database assumptions. The collation check in particular: with a
 *      locale-aware collation, fractional index ordering silently scrambles
 *      documents, and refusing to start is the only safe response.
 *   3. Migrations must already be applied — the entrypoint runs them before
 *      this process. Verified rather than assumed.
 *   4. Sync server, then HTTP, then maintenance.
 *
 * Shutdown order is the reverse, and the flush is the part that matters:
 * rooms hold up to PERSIST_MAX_DELAY_MS of unpersisted edits, so exiting
 * without awaiting it is user-visible data loss during a routine restart.
 */

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION } from '@sone/core';

import { loadConfig, type Config } from './config.js';
import { closePool, createPool, verifyDatabaseAssumptions } from './db/pool.js';
import {
  VersionFenceError,
  checkAndRecordVersion,
  pendingDocumentMigrations,
} from './db/version.js';
import { ensureSystemRoles } from './auth/standing.js';
import { registerInvitationRoutes } from './auth/invitationRoutes.js';
import { registerGroupRoutes } from './pages/groupRoutes.js';
import { registerRoleRoutes } from './auth/roleRoutes.js';
import { registerPagePermissionRoutes } from './pages/permissionRoutes.js';
import { registerOidcRoutes } from './auth/oidcRoutes.js';
import { installSecondFactorGate, registerAuthRoutes } from './http/auth.js';
import { factsFor, reachableWhileBlocked, standingOf } from './auth/requirement.js';
import { registerHealthRoutes, SONE_COMMIT, SONE_VERSION } from './http/health.js';
import { registerPageRoutes } from './http/pages.js';
import { registerCommentRoutes } from './comments/routes.js';
import { serveRefusal } from './http/refusal.js';
import { Router } from './http/router.js';
import { registerWorkspaceRoutes } from './http/workspaces.js';
import { registerFavouriteRoutes } from './http/favourites.js';
import { registerShareRoutes } from './http/share.js';
import { noteSignIn } from './mail/signIn.js';
import { registerCollectionRoutes } from './http/collections.js';
import { registerAdminRoutes } from './admin/routes.js';
import { SettingsStore } from './admin/settings.js';
import { registerExportRoutes } from './export/routes.js';
import { registerImportRoutes } from './import/routes.js';
import { WORKSPACE_EXPORT, workspaceExportHandler } from './export/workspaceJob.js';
import { registerJobRoutes } from './jobs/routes.js';
import { registerInboxRoutes } from './notifications/routes.js';
import { RECOMMENDED_COST, passwordCost } from './auth/password.js';
import { refusedEnvNumbers } from './env.js';
import { renderHtml, renderText, type Letter } from './mail/letter.js';
import { SONE_MARK_MIME, SONE_MARK_PNG } from './mail/mark.js';
import { sendMail } from './mail/send.js';
import { pollReplies, type ReplyDeps } from './jobs/replies.js';
import { sendActivityDigests } from './jobs/activityDigest.js';
import { sendRequirementMails } from './jobs/requirementMails.js';
import { runOneJob, type Job, type JobContext } from './jobs/runner.js';
import {
  EMAIL_NOTIFICATIONS,
  emailNotificationsHandler,
  sweepForEmail,
  type MailSettings,
} from './jobs/emailNotifications.js';
import {
  registerAvatarRoutes,
  registerBrandRoutes,
  registerFileRoutes,
} from './files/routes.js';
import { LocalFileStore } from './files/store.js';
import { createStaticHandler } from './http/static.js';
import { Maintenance } from './maintenance/job.js';
import { PROTOCOL_VERSION } from './sync/protocol.js';
import { SyncServer } from './sync/server.js';
import { queryOne, queryRows } from './db/pool.js';

/**
 * What the mark is called inside a message (ADR-0132).
 *
 * One name, because there is one picture: the HTML says `cid:sone-mark` and the
 * attachment answers to it. Two spellings would be a mail with a paperclip and
 * a broken image.
 */
const MARK_CID = 'sone-mark';

/** Time allowed for a graceful shutdown before the process is forced down. */
const SHUTDOWN_GRACE_MS = 20_000;

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    // Configuration errors are the most common first-run problem, so they get
    // the plainest possible message and no stack trace.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(78); // EX_CONFIG
  }

  console.log(`SONE ${SONE_VERSION} starting`);
  console.log(
    `document schema v${SCHEMA_VERSION}, sync protocol v${PROTOCOL_VERSION}`,
  );

  const pool = createPool(config.databaseUrl);

  try {
    await verifyDatabaseAssumptions(pool);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    await closePool();
    process.exit(78);
  }

  // The entrypoint applies migrations before starting this process. If the
  // table is missing, something ran the server directly without migrating,
  // and continuing would produce confusing errors on every request instead of
  // one clear one here.
  try {
    const rows = await queryRows<{ latest: string }>(
      pool,
      `SELECT max(version) AS latest FROM schema_migrations`,
    );
    const latest = rows[0]?.latest;
    if (!latest) throw new Error('no migrations applied');
    console.log(`database at migration ${latest}`);
  } catch (err) {
    console.error(
      'database is not migrated. Run: node packages/server/scripts/migrate.mjs',
    );
    console.error(err instanceof Error ? err.message : String(err));
    await closePool();
    process.exit(78);
  }

  /*
   * The four system roles have to exist, or nobody has any access (ADR-0087).
   *
   * Migration 0058 seeds them, which covers the ordinary path. This covers the
   * ones that are not exotic: a partial restore, a truncate, a database
   * rebuilt from a dump taken before that migration. Asserting an invariant at
   * boot costs four statements; discovering it at the first request costs an
   * instance where everybody is locked out and the logs say nothing.
   */
  await ensureSystemRoles(pool);

  // --- version fence -------------------------------------------------------
  // Refuses a downgrade or an invalid version skip before serving anything.
  // Allowing either would write old-format data into a new-format database,
  // from which the only recovery is a backup restore.
  try {
    const fence = await checkAndRecordVersion(pool, SONE_VERSION, SCHEMA_VERSION, {
      allowDowngrade: config.allowDowngrade,
    });
    if (fence.isFirstStart) {
      console.log('first start against this database');
    } else if (fence.isUpgrade) {
      console.log(
        `upgraded from ${fence.previous!.appVersion} to ${SONE_VERSION}` +
          (fence.isMajorUpgrade ? ' (major)' : ''),
      );
    }

    const pending = await pendingDocumentMigrations(pool, SCHEMA_VERSION);
    if (pending.length > 0) {
      const total = pending.reduce((sum, p) => sum + p.pages, 0);
      console.log(
        `${total} document(s) still at an older schema version; ` +
          `they migrate automatically when opened`,
      );
    }
  } catch (err) {
    if (err instanceof VersionFenceError) {
      console.error(err.message);

      // Serve the reason rather than exiting.
      //
      // Exiting left nothing answering on the port, so the symptom was a blank
      // page and a container that restart-looped, writing this same paragraph
      // to a log nobody was watching. The explanation was accurate and in the
      // one place the person affected was not looking.
      //
      // The database connection is closed first: this mode does no queries, and
      // holding a pool open against a database this build has decided it must
      // not touch would be the wrong shape of caution.
      const previousVersion = err.previousVersion;
      await closePool();

      serveRefusal(config.port, {
        message: err.message,
        code: err.code,
        runningVersion: SONE_VERSION,
        previousVersion,
      });

      console.error(
        `[fence] serving the reason on port ${config.port}. ` +
          'Nothing else is running: no editing, no sync, no writes.',
      );
      return;
    }
    throw err;
  }

  const http = createServer();

  const sync = new SyncServer({
    pool,
    databaseUrl: config.databaseUrl,
    server: http,
    path: '/sync',
  });
  await sync.start();

  const router = new Router();
  registerHealthRoutes(router, {
    pool,
    sync,
    documentSchemaVersion: SCHEMA_VERSION,
    syncProtocolVersion: PROTOCOL_VERSION,
  });
  // Constructed before every route that reads it, for the reason the
  // Maintenance object is: a closure that captures a const declared later works
  // only until somebody changes the ordering, and this project has already lost
  // an afternoon to exactly that.
  // One backend, and the configured path is always the configured path. It used
  // to be a ternary falling back to the default for `backend: 's3'` — which is
  // how uploads went to local disk while the operator believed they were in a
  // bucket (ADR-0107).
  const fileStore = new LocalFileStore(config.storage.path);

  // Checked once, loudly, at startup.
  //
  // Not fatal: an instance with an unwritable upload directory is still a
  // working notes app for everything except images, and refusing to start would
  // turn a broken volume mount into total downtime. But it must be said now
  // rather than discovered as a 500 on somebody's first photo — and it is also
  // reported in Settings → Maintenance, because a container log is not where
  // anybody looks when an upload fails.
  const storageProblem = await fileStore.checkWritable();
  if (storageProblem) {
    console.error(
      `[storage] ${storageProblem}\n` +
        '[storage] Image uploads will fail until this is fixed. The usual cause ' +
        'is a volume created before this directory existed in the image, so it ' +
        'is owned by root rather than by uid 10001. See docs/deployment.md.',
    );
  }

  // Settings resolve from the database over the environment, so the few values
  // an administrator changes take effect without a redeploy. Created before the
  // routes that read it.
  /*
   * A weakened password cost, said out loud (ADR-0010 amendment).
   *
   * Once at startup, and again as an anomaly in the maintenance panel: a
   * security parameter somebody set carelessly has to be visible where they
   * look, not only in a log line from three deploys ago.
   */
  if (passwordCost() < RECOMMENDED_COST) {
    console.warn(
      `SONE_PASSWORD_COST is 2^${passwordCost()}, below the recommended ` +
        `2^${RECOMMENDED_COST}. Every password hashed now is cheaper to attack. ` +
        'Raising it again upgrades existing passwords on their next sign-in.',
    );
  }

  /*
   * And every other number the environment offered and did not get (ADR-0111).
   *
   * The same argument one paragraph up, for a duller set of settings: the
   * instance runs on the documented default either way, and the difference
   * between an operator who knows that and one who does not is this line. Said
   * once, here, because these constants are read when their modules are
   * imported and there is no later moment at which somebody is looking.
   */
  for (const { key, value } of refusedEnvNumbers()) {
    console.warn(
      `${key}=${JSON.stringify(value)} is not a usable number for that setting; ` +
        'the built-in default is in use. Nothing else about this instance changes.',
    );
  }

  const settings = new SettingsStore(pool, {
    signupMode: config.signupMode,
    instanceName: 'SONE',
    allowWorkspaceCreation: true,
    defaultLocale: 'en',
    /*
     * No relay by default, which means no email (ADR-0058).
     *
     * From the environment so a deployment can set it without an administrator
     * filling a form, and overridable in the database so one who has can.
     */
    smtpHost: config.smtpHost ?? '',
    smtpPort: config.smtpPort ?? '587',
    smtpUser: config.smtpUser ?? '',
    smtpFrom: config.smtpFrom ?? '',
    smtpSecurity: 'starttls',
    emailDetail: 'title',
    // No mailbox by default, which means no replies (ADR-0060).
    // Off, and never having been on (ADR-0065).
    requireSecondFactor: false,
    requireSecondFactorSince: '',
    imapHost: config.imapHost ?? '',
    imapPort: config.imapPort ?? '993',
    imapUser: config.imapUser ?? '',
    imapFolder: 'INBOX',
    replyMailbox: config.replyMailbox ?? '',
    // "du" unless an instance says otherwise: it is what the interface said
    // before the setting existed, and a running instance should not change its
    // tone because it was upgraded.
    addressForm: 'informal',
  });

  /*
   * How this instance addresses people, for the mails (ADR-0133).
   *
   * The same setting the interface uses and read the same way — per send, not
   * captured at boot, because an operator who switches an instance to „Sie"
   * expects the next letter to obey rather than the next restart.
   */
  const addressForm = async () => (await settings.resolve()).values.addressForm;

  registerInvitationRoutes(router, {
    pool,
    baseUrl: config.publicUrl,
    instanceName: async () => (await settings.resolve()).values.instanceName,
    addressForm,
    /*
     * Present only while a relay is configured (ADR-0121).
     *
     * Read per send rather than captured at boot, like every other mail here:
     * an operator who configures the relay while SONE runs should not have to
     * restart for an invitation to be sent — which is the same reason
     * `sendResetMail` asks `mailSettings()` each time.
     */
    sendLetter: async (to, letter) => {
      await deliver(to, letter);
    },
  });
  registerPagePermissionRoutes(router, { pool });
  registerGroupRoutes(router, { pool });
  registerRoleRoutes(router, { pool });

  registerOidcRoutes(router, {
    pool,
    clientSecret: config.oidcClientSecret,
    publicUrl: config.publicUrl,
    // Decided the same way as everywhere else here, rather than a new setting.
    secureCookies: config.publicUrl.startsWith('https://'),
    // Signs the pending sign-in cookie (ADR-0082).
    secretKey: config.secretKey,
  });

  /*
   * The requirement gate (ADR-0065).
   *
   * Installed once, and it returns null immediately when the requirement is
   * off — a check on every authenticated request has to be free when the
   * feature is not in use.
   */
  installSecondFactorGate(async (gatePool, userId, path) => {
    const resolved = await settings.resolve();
    if (!resolved.values.requireSecondFactor) return null;
    if (reachableWhileBlocked(path)) return null;

    const facts = await factsFor(gatePool, userId);
    if (!facts) return null;

    const standing = standingOf(
      { required: true, since: resolved.values.requireSecondFactorSince },
      facts,
    );
    return standing.kind === 'blocked' ? 'second_factor_required' : null;
  });

  registerAuthRoutes(router, {
    pool,
    secretKey: config.secretKey,
    /*
     * What this instance looks like, on the one route that answers before
     * anybody has signed in (ADR-0123).
     *
     * Read per request rather than captured, like everything else here: an
     * administrator changes a logo while the process runs.
     */
    brand: () => settings.brand(),
    /*
     * Note the browser somebody signed in from (ADR-0130).
     *
     * Every part read per call, like the rest of the mail here: an operator
     * switches the welcome on while the process runs.
     */
    noteSignIn: (userId, meta) =>
      noteSignIn(
        {
          pool,
          baseUrl: config.publicUrl,
          instanceName: async () => (await settings.resolve()).values.instanceName,
          addressForm,
          welcome: async () => (await settings.resolve()).values.welcomeMail,
          canSendMail: async () => (await mailSettings()).relay !== null,
          sendLetter: async (to, letter) => {
            await deliver(to, letter);
          },
        },
        userId,
        meta,
      ),
    // What an authenticator app lists the entry under, so somebody with three
    // SONE instances can tell them apart (ADR-0063).
    instanceName: async () => (await settings.resolve()).values.instanceName,
    /*
     * Where an account stands (ADR-0065).
     *
     * The same two facts the gate reads, and the same function deciding — one
     * answer to "does this person still need to enrol", not two that can
     * disagree about the deadline.
     */
    secondFactorStanding: async (userId) => {
      /*
       * The standing *and* the facts it came from.
       *
       * The session needs both — whether an authenticator is enrolled, for the
       * settings screen, and where the account stands, for the banner — and
       * they come out of one row. Returning only the standing meant the caller
       * asked a second time.
       */
      const resolved = await settings.resolve();
      const facts = (await factsFor(pool, userId)) ?? {
        hasSecondFactor: false,
        hasPassword: false,
      };

      if (!resolved.values.requireSecondFactor) {
        return { standing: { kind: 'fine' as const }, facts };
      }

      const standing = standingOf(
        { required: true, since: resolved.values.requireSecondFactorSince },
        facts,
      );
      return {
        standing:
          standing.kind === 'grace'
            ? { kind: 'grace' as const, deadline: standing.deadline.toISOString() }
            : standing,
        facts,
      };
    },
    /*
     * Whether a reset can be offered at all (ADR-0059).
     *
     * Read on each call, not captured: an administrator can set the mail server
     * while the process runs, and a boolean taken at startup would leave the
     * reset absent until a restart.
     */
    // Asked, not cached: a cached host is a third place the truth lives, and
    // this is one settings read on a route somebody uses twice a year.
    canSendMail: async () => (await mailSettings()).relay !== null,
    // The mail an account with no password gets instead of a link (ADR-0059).
    sendProviderMail: async (to) => {
      const current = await mailSettings();
      if (!current.relay) return;
      await sendMail(current.relay, {
        to,
        subject: 'SONE: signing in to your account',
        body:
          'Somebody asked to set a new password for this address.\n\n' +
          'This account signs in through your identity provider rather than ' +
          'with a password here, so there is nothing to reset. Use the ' +
          'single sign-on button on the sign-in page.\n\n' +
          `${config.publicUrl}/login\n\n` +
          'If this was not you, nothing has changed and you can ignore it.\n',
      });
    },
    sendResetMail: async (to, token, expiresAt) => {
      const current = await mailSettings();
      if (!current.relay) return;
      const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
      await sendMail(current.relay, {
        to,
        subject: 'SONE: set a new password',
        // Less than a notification says (ADR-0059): a link, how long it works,
        // and that it can be ignored. Everything else is something an attacker
        // who guessed an address would get for free.
        body:
          `Somebody asked to set a new password for this address.\n\n` +
          `${config.publicUrl}/reset?token=${token}\n\n` +
          `The link works for ${minutes} minutes and once. ` +
          `If this was not you, nothing has changed and you can ignore it.\n`,
      });
    },
    // Read per request, not captured at startup: an administrator who changes
    // this in the interface expects the next registration attempt to obey it.
    signupMode: () => settings.get('signupMode'),
    addressForm: () => settings.get('addressForm'),
    // Secure cookies only over https, or the browser drops them on a plain
    // http development instance and login silently fails.
    secureCookies: config.publicUrl.startsWith('https://'),
  });
  registerPageRoutes(router, { pool });
  registerCommentRoutes(router, { pool });
  registerWorkspaceRoutes(router, { pool });
  registerFavouriteRoutes(router, { pool });
  registerShareRoutes(router, {
    pool,
    publicUrl: config.publicUrl,
    secretKey: config.secretKey,
    // Derived the same way the auth routes derive it, rather than a second
    // setting that could disagree with the first.
    secureCookies: config.publicUrl.startsWith('https://'),
    /*
     * Handing a link over by mail (ADR-0126).
     *
     * The same four functions the invitation routes take, read per send rather
     * than captured: an operator configures the relay while SONE runs, and how
     * much a mail may name is a setting they can change on a Tuesday.
     */
    canSendMail: async () => (await mailSettings()).relay !== null,
    emailDetail: async () => (await settings.resolve()).values.emailDetail,
    instanceName: async () => (await settings.resolve()).values.instanceName,
    addressForm,
    sendLetter: async (to, letter) => {
      await deliver(to, letter);
    },
  });
  registerCollectionRoutes(router, { pool });

  // Constructed before the routes that reference it, not after.
  //
  // The admin route captures `maintenance` in a closure that only runs when a
  // request arrives, so declaring it later would work — until it did not. This
  // project has already lost an afternoon to a const referenced before its
  // assignment (the editor view in dispatchTransaction), and "it happens to be
  // assigned by the time anyone calls it" is the same argument that was wrong
  // then.
  const maintenance = new Maintenance({
    pool,
    sync,
    workspaceRetentionDays: config.workspaceRetentionDays,
    // For freeing what an expired export left in storage (ADR-0044).
    store: fileStore,
    /*
     * The three mails with no moment to hang on (ADR-0129).
     *
     * Here because this is the loop that comes round: an invitation nobody
     * redeemed and a link about to expire are true for days at a stretch, and
     * neither has a request to be sent from.
     */
    reminders: {
      baseUrl: config.publicUrl,
      instanceName: async () => (await settings.resolve()).values.instanceName,
      emailDetail: async () => (await settings.resolve()).values.emailDetail,
      addressForm,
      /*
       * Asked before anything is claimed, and not the same question as having
       * a sender: the sender below exists always and quietly does nothing
       * without a relay, which would mark every reminder as sent while sending
       * none.
       */
      canSendMail: async () => (await mailSettings()).relay !== null,
      sendLetter: async (to, letter) => {
        await deliver(to, letter);
      },
    },
  });

  /*
   * The job runner: its own timer, faster than maintenance (ADR-0044).
   *
   * Not a task inside the maintenance job, which runs on a slow schedule
   * because everything in it is housekeeping — somebody waiting for an export
   * would wait for the next sweep. A separate interval, and one job per tick so
   * a queue drains steadily rather than one tick holding the process for an
   * hour.
   */
  /*
   * Where mail goes, read fresh on each tick (ADR-0058).
   *
   * From the settings store rather than captured at startup, so an
   * administrator who corrects a port does not have to restart — the same
   * reason the settings exist in the database at all.
   */
  const mailSettings = async (): Promise<MailSettings> => {
    const resolved = await settings.resolve();
    const host = resolved.values.smtpHost.trim();
    return {
      relay:
        host === ''
          ? null
          : {
              host,
              port: Number(resolved.values.smtpPort) || 587,
              user: resolved.values.smtpUser,
              password: config.smtpPassword ?? '',
              from: resolved.values.smtpFrom || `sone@${host}`,
              security: resolved.values.smtpSecurity,
            },
      detail: resolved.values.emailDetail,
      addressForm: resolved.values.addressForm,
      baseUrl: config.publicUrl,
      // Only when a mailbox is being polled: inviting a reply nobody reads
      // would be inviting somebody to write into a void (ADR-0060).
      replyMailbox: resolved.values.imapHost.trim() === '' ? null : resolved.values.replyMailbox,
      secret: config.secretKey,
    };
  };

  /**
   * Hand one letter to the relay, with the mark attached (ADR-0132).
   *
   * One function, because there were four copies of these four lines and a
   * fifth thing to say — the picture — would have been four more. A letter that
   * carried a mark from three senders and not the fourth is exactly the drift
   * ADR-0121 built one structure to prevent.
   *
   * The instance's own logo where it has one, and SONE's otherwise. Read per
   * send rather than captured: an administrator uploads a mark while the
   * process runs, and a mail is the last place anybody would notice a stale one.
   *
   * A failure to read the logo is not a failure to send. The mark is decoration
   * and the letter is the message; a storage hiccup must not swallow somebody's
   * password reset.
   */
  const deliver = async (to: string, letter: Letter): Promise<void> => {
    const current = await mailSettings();
    if (!current.relay) return;

    const resolved = await settings.resolve();
    let picture: { cid: string; mime: string; base64: string } | null = null;
    try {
      const own = resolved.values.brandLogo;
      picture = own
        ? { cid: MARK_CID, mime: own.mime, base64: (await fileStore.get(own.key)).toString('base64') }
        : { cid: MARK_CID, mime: SONE_MARK_MIME, base64: SONE_MARK_PNG };
    } catch {
      // The bytes named by the setting are gone — a restored database against a
      // fresh storage directory. The wordmark as text is what the letter falls
      // back to, which is what every mail looked like before this.
      picture = { cid: MARK_CID, mime: SONE_MARK_MIME, base64: SONE_MARK_PNG };
    }

    const drawn: Letter = {
      ...letter,
      logoCid: MARK_CID,
      logoAlt: resolved.values.instanceName,
    };
    await sendMail(current.relay, {
      to,
      subject: drawn.subject,
      body: renderText(drawn),
      html: renderHtml(drawn),
      inline: [picture],
    });
  };

  /*
   * Where replies are read from, and what to say to one we cannot use
   * (ADR-0060).
   *
   * Read fresh like the mail settings, for the same reason: an administrator
   * can point it at a different mailbox without a restart.
   */
  const replySettings = async (): Promise<ReplyDeps | null> => {
    const resolved = await settings.resolve();
    const host = resolved.values.imapHost.trim();
    const mailbox = resolved.values.replyMailbox.trim();
    if (host === '' || mailbox === '') return null;

    return {
      pool,
      mailbox: {
        host,
        port: Number(resolved.values.imapPort) || 993,
        user: resolved.values.imapUser,
        password: config.imapPassword ?? '',
        folder: resolved.values.imapFolder || 'INBOX',
      },
      secret: config.secretKey,
      refuse: async (to, reason) => {
        const current = await mailSettings();
        /*
         * A refusal that cannot be sent is said out loud instead.
         *
         * It used to `return` here, silently, while the poll went on to mark
         * the message read — so an instance with IMAP configured and no relay
         * ate every unusable reply and told nobody: not the sender, not the
         * operator, not a log. That is the exact outcome ADR-0060 exists to
         * prevent, arrived at by a different road (ADR-0078).
         */
        if (!current.relay || to === null) {
          console.warn(
            `[replies] could not refuse a reply (${reason}): ` +
              (to === null
                ? 'the From header holds no address that can be written to'
                : 'no mail relay is configured'),
          );
          return;
        }
        /*
         * One short mail, and it says which of the reasons it was.
         *
         * Silence would leave somebody believing they had answered a colleague
         * — which is worse than a bounce, because a bounce at least tells them
         * something went wrong.
         */
        const sentence = {
          expired_link: 'That reply link had expired. Open the page in SONE to answer.',
          not_for_us: 'That address is not one SONE recognises.',
          no_text:
            'There was no plain text in that reply. Some mail clients send HTML ' +
            'only; sending as plain text will work.',
          thread_gone: 'The comment that mail was about is no longer there.',
          no_access: 'You no longer have access to that page.',
        }[reason];

        await sendMail(current.relay, {
          to,
          subject: 'SONE: your reply was not posted',
          body: `${sentence}\n\nNothing was posted.\n`,
        });
      },
    };
  };

  const jobHandlers = {
    [WORKSPACE_EXPORT]: workspaceExportHandler(pool, fileStore),
    [EMAIL_NOTIFICATIONS]: async (job: Job, ctx: JobContext) =>
      emailNotificationsHandler(pool, await mailSettings())(job, ctx),
  };
  /*
   * The sweep that turns aged notifications into jobs (ADR-0058).
   *
   * On the same timer as the runner, and doing nothing at all without a relay:
   * no claim, no job, no queue filling up.
   */
  /*
   * Reading replies, on its own timer (ADR-0060).
   *
   * Two minutes, which is the cost of polling and is stated in the record
   * rather than hidden: a reply appears in the page up to that late, and
   * nothing in the interface may suggest otherwise.
   */
  /*
   * One poll at a time.
   *
   * A poll can legitimately take longer than the interval — up to fifty
   * messages, each with its own step timeout — and two overlapping polls both
   * `SEARCH UNSEEN`, both find the same message, and both can post it before
   * either marks it read. The reply appears twice, as two comments, because
   * nothing dedupes on the mail's own Message-ID. A flag is the whole fix
   * (ADR-0078).
   */
  let polling = false;
  const replyTimer = setInterval(() => {
    if (polling) return;
    polling = true;
    void replySettings()
      .then((current) => (current ? pollReplies(current) : null))
      .then((result) => {
        // Said, because it was not. The counts were computed, returned and
        // dropped on the floor, so nothing anywhere recorded that a reply had
        // been posted — or that fifty had been refused.
        if (result && result.posted + result.refused > 0) {
          console.log(
            `[replies] posted ${result.posted}, refused ${result.refused}, ignored ${result.ignored}`,
          );
        }
      })
      .catch((err: unknown) => {
        /*
         * A mailbox that cannot be reached is tried again in two minutes.
         * Throwing here would take the process down for somebody else's outage
         * — but swallowing it without a word made an unreachable mailbox, a
         * wrong password and a database error identical and invisible, and
         * comments silently stopped arriving with nothing to look at.
         */
        console.error('[replies] poll failed', err);
      })
      .finally(() => {
        polling = false;
      });
  }, 120_000);
  replyTimer.unref();

  /*
   * The activity digest, hourly so each timezone's eight o'clock is caught
   * (ADR-0062).
   *
   * The same timer shape as the notification sweep, and the query itself is
   * what decides whose hour it is — a second schedule kept in JavaScript would
   * be a second answer to the question the SQL already answers.
   */
  /*
   * The two requirement mails, on the same hourly beat (ADR-0065).
   *
   * Which stage is due is decided from the deadline, and which accounts have
   * had it is a recorded fact — so a sweep running twice in an hour sends
   * nothing the second time.
   */
  const requirementTimer = setInterval(() => {
    void mailSettings()
      .then(async (current) => {
        const resolved = await settings.resolve();
        return sendRequirementMails({
          pool,
          relay: current.relay,
          baseUrl: current.baseUrl,
          required: resolved.values.requireSecondFactor,
          since: resolved.values.requireSecondFactorSince,
        });
      })
      .catch(() => {
        // Tried again next hour. A relay that is down must not take the
        // process with it.
      });
  }, 3_600_000);
  requirementTimer.unref();

  const digestTimer = setInterval(() => {
    void mailSettings()
      .then((current) =>
        sendActivityDigests({
          pool,
          relay: current.relay,
          detail: current.detail,
          ...(current.addressForm ? { addressForm: current.addressForm } : {}),
          baseUrl: current.baseUrl,
        }),
      )
      .then((result) => {
        // Said, because it was not: the counts were computed, returned and
        // dropped, so nothing anywhere recorded that a digest had gone out or
        // that ten had failed (ADR-0081).
        if (result.sent > 0 || result.failed.length > 0) {
          console.log(`[digest] sent ${result.sent}, empty ${result.empty}`);
        }
        for (const failure of result.failed) {
          console.error(`[digest] could not send — ${failure}`);
        }
      })
      .catch((err: unknown) => {
        // Tried again next hour. A relay that is down must not take the
        // process with it — but it must not be invisible either.
        console.error('[digest] hourly pass failed', err);
      });
  }, 3_600_000);
  digestTimer.unref();

  const mailTimer = setInterval(() => {
    void mailSettings()
      .then((current) => sweepForEmail(pool, current))
      .catch((err: unknown) => {
        // A sweep that cannot reach the database will be tried again in a
        // minute; throwing here would take the process down for it. Saying
        // nothing at all made an unreachable database, a schema drift and a
        // relay outage identical and invisible (ADR-0081).
        console.error('[mail] sweep failed', err);
      });
  }, 60_000);
  mailTimer.unref();

  const jobTimer = setInterval(() => {
    void runOneJob(pool, jobHandlers).catch(() => {
      // Logged by the job row itself. A throw here would be an unhandled
      // rejection in a timer, which takes the process down for one bad export.
    });
  }, 5_000);
  // So a test or a shutdown is not held open by a timer.
  jobTimer.unref();

  registerJobRoutes(router, { pool, store: fileStore });

  // Being told when somebody asked you something (ADR-0052).
  registerInboxRoutes(router, { pool });

  registerAdminRoutes(router, {
    pool,
    oidcClientSecret: config.oidcClientSecret,
    // One mail to the administrator asking, so a wrong password says so
    // immediately instead of becoming a failed job (ADR-0058).
    sendTestMail: (relay, to) =>
      sendMail(relay, {
        to,
        subject: 'SONE: mail works',
        body:
          'This is the test mail from your SONE instance.\n\n' +
          'If you are reading it, the mail server settings are correct and ' +
          'notification emails will reach people.\n',
      }),
    smtpPassword: config.smtpPassword,
    // The person whose account was disarmed is exactly who needs to know
    // (ADR-0063).
    tellFactorRemoved: async (to, byWhom) => {
      const current = await mailSettings();
      if (!current.relay) return;
      await sendMail(current.relay, {
        to,
        subject: 'SONE: your second factor was removed',
        body:
          `${byWhom} removed the second factor from your SONE account.\n\n` +
          'You can sign in with your password alone now, and set up a new ' +
          'authenticator under You → Security.\n\n' +
          `${config.publicUrl}/settings/security\n\n` +
          'If you did not ask for this, tell whoever runs this instance ' +
          'straight away.\n',
      });
    },
    settings,
    version: SONE_VERSION,
    commit: SONE_COMMIT,
    checkStorage: () => fileStore.checkWritable(),
    // The same job the timer runs, so the button and the schedule cannot drift.
    runMaintenance: () =>
      maintenance.runOnce() as unknown as Promise<Record<string, unknown>>,
  });
  // The same store, and a route that is not an attachment route (ADR-0029).
  registerAvatarRoutes(router, {
    pool,
    store: fileStore,
    maxUploadBytes: config.maxUploadBytes,
  });
  // The same store again, and the only file on this instance served to nobody
  // in particular: the mark is on the sign-in screen (ADR-0123).
  registerBrandRoutes(router, {
    pool,
    store: fileStore,
    settings,
    maxUploadBytes: config.maxUploadBytes,
  });
  // Handing a page's contents back (ADR-0044). Its own module because it is the
  // one thing that needs both the database and the file store.
  registerExportRoutes(router, { pool, store: fileStore });

  // Reading an archive in (ADR-0044). The plan and the execution are separate
  // routes so that nothing is written before somebody has seen what would be.
  registerImportRoutes(router, {
    pool,
    store: fileStore,
    maxUploadBytes: config.maxUploadBytes,
  });

  registerFileRoutes(router, {
    pool,
    // Only the local backend exists so far. The interface is in place so an S3
    // one can be added without anything above it changing.
    store: fileStore,
    maxUploadBytes: config.maxUploadBytes,
  });

  // The built client is served by this process, so a deployment is one
  // container plus Postgres rather than app plus a separate nginx.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticHandler = await createStaticHandler({
    root: path.resolve(here, '../../web/dist'),
  });

  http.on('request', (req, res) => {
    void (async () => {
      try {
        if (await router.handle(req, res, config.publicUrl)) return;
        if (await staticHandler(req, res)) return;
        if (!res.headersSent) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
        }
      } catch (err) {
        console.error('[http] unhandled request error', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
      }
    })();
  });

  // Started only once the server is otherwise wired: a pass that runs while
  // routes are still being registered would compete with startup for the pool.
  maintenance.start();

  await new Promise<void>((resolve) => {
    http.listen(config.port, resolve);
  });
  console.log(`listening on port ${config.port}`);
  console.log(`public URL ${config.publicUrl}`);
  if (config.signupMode !== 'invite') {
    console.log(`signup mode: ${config.signupMode}`);
  }

  // --- shutdown ------------------------------------------------------------

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      // A second signal means the operator is impatient. Honour it.
      console.warn(`${signal} received again, exiting immediately`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);

    // Force exit if the graceful path hangs. Without this a stuck flush turns
    // a restart into an outage requiring SIGKILL.
    const forceTimer = setTimeout(() => {
      console.error(`shutdown exceeded ${SHUTDOWN_GRACE_MS} ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceTimer.unref();

    maintenance.stop();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    // Flushes every room. This is the call that must not be skipped.
    await sync.shutdown();
    await closePool();

    clearTimeout(forceTimer);
    console.log('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // An unhandled rejection has already escaped every guard in the code. Log it
  // and keep running: crashing would drop every live connection and lose the
  // unflushed tail of every open document, which is worse than one broken
  // request.
  process.on('unhandledRejection', (reason) => {
    console.error('unhandled rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('uncaught exception', err);
    void shutdown('uncaughtException');
  });
}

void main().catch((err) => {
  console.error('failed to start', err);
  process.exit(1);
});
