# ADR-0010: Server-side sessions, scrypt from the standard library

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

SONE needs password authentication, sessions, invitations and share links. Two
choices in this area are hard to reverse once accounts exist: how passwords are
hashed, and whether sessions are stateful.

## Decision

**Sessions are rows, not signed tokens.** ADR-0006 rejected stateless tokens
for share links because revoking a leaked link must take effect immediately.
The same argument applies to sessions, and one mechanism is better than two.

**Password hashing is scrypt from `node:crypto`.** No bcrypt, no argon2
package. Both are native addons that complicate the Docker build across
architectures, and ADR-0004 argues for fewer dependencies precisely in the
places that must not break. Parameters: N=2^16, r=8, p=1 — roughly 64 MB and
~100 ms, tuned to be uncomfortable for an attacker holding the database while
remaining tolerable on a Raspberry Pi running a family instance, which is a
real deployment target here.

Supporting decisions, each with a failure mode behind it:

- **Only digests are stored.** Session tokens, invitations, share links and
  reset tokens are all stored as SHA-256 digests. Plain SHA-256 without a KDF
  is correct for these: the token is already 256 bits of randomness, so there
  is nothing to guess offline, and using scrypt would make every request pay
  100 ms for no gain.
- **The stored hash carries its own parameters** (`scrypt$N$r$p$salt$hash`), so
  the cost can be raised later without invalidating existing passwords.
  `verifyPassword` reports `needsRehash` and login upgrades transparently.
- **Login always performs a hash comparison**, even for an unknown address,
  against a fixed dummy hash. Otherwise response timing reveals which accounts
  exist.
- **Passwords are normalised NFKC** before hashing. Without it, a password
  containing an accent set on one keyboard cannot be entered from another.
- **Length-only password policy**, minimum 12 characters. Composition rules
  measurably push people towards `Password1!`.
- **Rate limiting lives in Postgres**, not in memory. An in-memory counter is
  reset by a restart — which an attacker cannot cause, but a crash-looping
  container can, accidentally.
- **Changing a password revokes sibling sessions.** A password change after a
  suspected compromise is worthless if the attacker's session survives it.
- **Revoking a share link deletes its anonymous sessions.** Otherwise an
  anonymous editor keeps working after revocation.
- **"Account already exists" is reported plainly** on registration. Hiding it
  achieves nothing — the reset form leaks the same fact — and the ambiguity
  only confuses the legitimate user who forgot they had an account.

## Amendment: the cost is configurable, with a floor and a warning

Measured while asking why the server's test suite no longer finishes inside one
command. A hash costs **216 ms** on this machine at N=2^16; `api.db.test.ts`
registers an account per test through the real route, 105 times, so **roughly
half that file's 45 seconds is password hashing**. N=2^14 is 50 ms and N=2^12 is
11 ms.

A suite people stop running is worse than a slightly slower one, so the work
factor comes from configuration now: `SONE_PASSWORD_COST` as the exponent,
defaulting to 16.

**The safeguard, and why it is not a test-only backdoor.** A knob that weakens
every password on an instance where somebody set it carelessly is worse than a
slow test suite. So:

- The stored hash already records N, r and p, and `verifyPassword` already
  reports `needsRehash` when a stored hash is weaker than the current setting.
  A cost change therefore upgrades existing passwords on next sign-in rather
  than stranding them — that was true before this amendment and is what makes it
  safe.
- Anything below 16 logs a warning at startup naming the value and the default.
- And it is an anomaly in the maintenance panel, counted like a failed
  projection, so it is visible where an operator looks rather than only in a log
  line they scrolled past three deploys ago.

Not keyed on `NODE_ENV`: a security parameter that changes because of an
environment variable somebody else set is a parameter nobody can reason about.
The tests set the cost explicitly, in the open, the same way an operator would.

## Consequences

Every authenticated request costs one indexed lookup on `sessions`. Acceptable,
and it buys immediate revocation and a real "active sessions" list.

`last_seen_at` is touched at most every five minutes rather than per request,
so a page load does not become a database write.

`sessions` and `auth_attempts` grow and need pruning. `pruneAuthTables` exists
for the maintenance job; if it is never scheduled, the tables grow without
bound. That job is a required piece of operational work, not an optimisation.

scrypt at these parameters means roughly 64 MB per concurrent login. A burst of
simultaneous logins is therefore a memory spike, bounded in practice by the
rate limiter but worth remembering before raising N further.

## Alternatives considered

**JWT sessions with short expiry and refresh tokens.** Standard, and rejected:
it reintroduces the revocation delay that ADR-0006 already rejected, and adds
a second token lifecycle to reason about.

**Argon2id via a package.** Better hash function. Rejected on the native-addon
build cost; the stored format leaves the door open, and switching later is a
transparent upgrade rather than a migration.

**Rate limiting in memory or via Redis.** In memory does not survive restarts;
Redis was already rejected in ADR-0005.
