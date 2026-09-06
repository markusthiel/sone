/**
 * The first sign-in, and every unfamiliar one after (ADR-0130).
 *
 * The last two of the six mails proposed beside ADR-0121:
 *
 * > 2. **Anmeldung von einem neuen Gerät.** Auf einer selbst gehosteten Instanz
 * >    die nützlichste Sicherheitsmail, und die einzige, die einen Einbruch
 * >    sichtbar macht.
 * > 6. **Willkommensmail nach der ersten Anmeldung.** Optional, abschaltbar.
 *
 * They are one question asked twice — *is this browser new to this account* —
 * and the difference is only whether there was anything to compare against.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { noteSignIn } from '../src/mail/signIn.js';
import type { Letter } from '../src/mail/letter.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';

describe(
  'signing in from somewhere new (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let posted: Array<{ to: string; letter: Letter }>;
    let welcomes = false;

    const deps = () => ({
      pool: db,
      baseUrl: 'https://sone.example.org',
      instanceName: () => Promise.resolve('Haus Thiel'),
      welcome: () => Promise.resolve(welcomes),
      sendLetter: (to: string, letter: Letter) => {
        posted.push({ to, letter });
        return Promise.resolve();
      },
    });

    const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
    const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1';

    before(async () => {
      db = await getTestPool();
    });

    after(async () => {
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);
      await db.query(`UPDATE users SET email = 'anna@example.org' WHERE id = $1`, [fx.userId]);
      posted = [];
      welcomes = false;
    });

    const signIn = (userAgent: string | null, ip = '203.0.113.0/24') =>
      noteSignIn(deps(), fx.userId, { userAgent, ipPrefix: ip });

    // --- the first one -------------------------------------------------------

    test('the first sign-in of all is not a warning', async () => {
      // There is nothing to compare against, and "a browser you have not used"
      // is every browser on the day somebody starts.
      assert.equal(await signIn(FIREFOX), 'first');
      assert.deepEqual(posted, []);
    });

    test('and it is the welcome, where an instance sends one', async () => {
      welcomes = true;
      assert.equal(await signIn(FIREFOX), 'first');

      assert.equal(posted.length, 1);
      assert.match(posted[0]!.letter.subject, /welcome/i);
    });

    test('which is off unless somebody chose it', async () => {
      /*
       * The one mail here nobody needs: on an instance where an administrator
       * makes accounts for colleagues and tells them in person, it is a message
       * about something they were just told.
       */
      const { welcome: _none, ...noOpinion } = deps();
      assert.equal(await noteSignIn(noOpinion, fx.userId, { userAgent: FIREFOX, ipPrefix: null }), 'first');
      assert.deepEqual(posted, []);
    });

    // --- an unfamiliar one ---------------------------------------------------

    test('a second browser is mentioned once', async () => {
      await signIn(FIREFOX);
      assert.equal(await signIn(PHONE), 'new');

      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.to, 'anna@example.org');
      assert.match(JSON.stringify(posted[0]!.letter), /203\.0\.113/, 'where it was seen from');
    });

    test('and the same browser again is not mentioned at all', async () => {
      /*
       * The reason this is a table rather than a look at `sessions`. Sessions
       * expire and are pruned, so a browser somebody uses every few weeks would
       * become "new" again — and the mail that exists to make an intrusion
       * visible would become the mail everybody filters.
       */
      await signIn(FIREFOX);
      await signIn(PHONE);
      posted = [];

      assert.equal(await signIn(FIREFOX), 'known');
      assert.equal(await signIn(PHONE), 'known');
      assert.deepEqual(posted, []);
    });

    test('it says what was seen, and does not guess a device name', async () => {
      /*
       * "Firefox on Linux" is a guess parsed out of a string anybody can set,
       * and a wrong guess in a security notice is worse than none: the reader
       * checks it against what they know and dismisses a real warning.
       */
      await signIn(FIREFOX);
      await signIn(PHONE);

      const said = JSON.stringify(posted[0]!.letter);
      assert.match(said, /iPhone/, 'the agent as received');
      assert.doesNotMatch(said, /Safari on iOS|iOS device/);
    });

    test('and it says what it cannot promise', async () => {
      // An attacker who copies a user agent defeats this entirely. Saying so is
      // what keeps somebody from trusting it as a control.
      await signIn(FIREFOX);
      await signIn(PHONE);
      assert.match(JSON.stringify(posted[0]!.letter.footer), /not proof/i);
    });

    // --- when nothing is sent ------------------------------------------------

    test('an account with no address is still remembered', async () => {
      /*
       * The device is noted whether or not anybody can be written to. A guest
       * account (ADR-0033) has no address, and forgetting the browser would
       * mean a letter waiting to be sent the day one is added.
       */
      await db.query(`UPDATE users SET email = NULL WHERE id = $1`, [fx.userId]);
      await signIn(FIREFOX);
      assert.equal(await signIn(PHONE), 'new');
      assert.deepEqual(posted, []);

      const rows = await db.query(`SELECT 1 FROM known_devices WHERE user_id = $1`, [fx.userId]);
      assert.equal(rows.rowCount, 2);
    });

    test('and with no relay the device is remembered too', async () => {
      // Same reason, and the one that would otherwise arrive as a burst of
      // letters about old browsers the first time mail is configured.
      const { sendLetter: _none, ...withoutRelay } = deps();
      await noteSignIn(withoutRelay, fx.userId, { userAgent: FIREFOX, ipPrefix: null });
      await noteSignIn(withoutRelay, fx.userId, { userAgent: PHONE, ipPrefix: null });

      const rows = await db.query(`SELECT 1 FROM known_devices WHERE user_id = $1`, [fx.userId]);
      assert.equal(rows.rowCount, 2);
    });

    test('a browser that says nothing about itself is one browser', async () => {
      // Not a special case: an absent user agent hashes like any other value,
      // so a second sign-in with none is the same one rather than another.
      await signIn(null);
      posted = [];
      assert.equal(await signIn(null), 'known');
      assert.deepEqual(posted, []);
    });
  },
);
