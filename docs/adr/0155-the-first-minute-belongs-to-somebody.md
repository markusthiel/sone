# ADR-0155: The first minute belongs to somebody

## Status

Accepted. Built. Asked for, by way of a question about a sibling project: SOTE
had made the first account a command-line step, that was reported as clumsy, and
the fix there raised the question of how SONE does it. Reading SONE's answer
found a window this closes — and reading SOTE's found a lock SONE already had
and SOTE did not. Both were fixed.

Changes one route (`POST /api/auth/setup`), one screen, and adds one startup
message. No migration, no data change. An instance already set up is unaffected.

## Context

`POST /api/auth/setup` was unauthenticated and gated on one condition:

```sql
SELECT count(*) FROM workspaces
```

Zero means the instance needs setup; the route creates the first workspace and
its owner, and `registration.ts` makes that account the instance administrator.
The gate is serialised with `pg_advisory_xact_lock(hashtext('sone:bootstrap'))`,
so two simultaneous attempts cannot both succeed.

That is correct. It is also not enough, because the condition is true for a
window that somebody else can be inside.

**The window.** A container starts. The proxy in front of it is already
answering on a public name — that is what a proxy is for, and it does not wait
for the operator to be ready. Between the first successful start and the moment
the operator opens the page, whoever reaches the URL becomes the instance
administrator of that deployment: an account, a personal workspace, and
`is_instance_admin`. Every account created afterwards has no administrative
rights at all, by design. The operator's own attempt then answers *this instance
is already set up*, and the way back is:

```sql
UPDATE users SET is_instance_admin = true WHERE email = 'you@example.org';
```

which `docs/deployment.md` already documents as the recovery from a lost
administrator.

Nothing about that window looks wrong while it happens. There is no failed
request, no log line, no mail. The operator sees a login screen where they
expected a setup screen, and the natural reading is "I must have set this up
already".

**The second window** is narrower and worse. `count(*) FROM workspaces` returns
to zero if every account is gone, because a personal workspace goes with its
account (ADR-0025, and the purge in `maintenance/job.ts` never touches a
personal one while its owner exists). So an instance that lost its accounts
re-opens setup — with the team workspaces still in the database, now available
to whoever arrives first.

Neither window is exotic. The first is the ordinary first minute of a
self-hosted deployment.

## Decision

**A setup key, printed to the log at startup while setup is still needed, and
required by the route.**

```
  ┌─ Setup ──────────────────────────────────────────────────
  │  This instance has no workspace yet. Open SONE and enter
  │  this setup key:
  │
  │      Xk7q-…
  │
  │  It is good for one account and expires on restart.
  └──────────────────────────────────────────────────────────
```

Six decisions inside that:

**The key lives in memory, not in the database.** In a table it would be a
secret in every backup, which ADR-0058 forbids for SMTP and OIDC credentials and
forbids here for the same reason. It expires on restart and is spent with the
first account. Whoever missed it restarts and gets a new one — which is a worse
experience than a permanent value and a much better one than a permanent
secret.

**The database is checked first, the key second.** Reversed, a wrong key on a
live instance would answer `invalid_setup_key` and so confirm that setup was
still open. In this order a live instance says the same thing to everybody:
already set up.

**A missing key and a wrong key give the same answer.** A distinct "no key
given" would tell a stranger that a key exists and is what they are missing.

**Constant-time comparison.** Not because 192 bits are guessable from timing,
but because the alternative is a comparison whose duration depends on the
secret, and that is a habit rather than a calculation.

**An absent gate means closed, not open.** `AuthDeps.setupGate` is optional and
the route substitutes a gate that matches nothing. Absent-means-open would turn
one forgotten wiring into exactly the hole this closes, silently;
absent-means-closed turns the same mistake into *I cannot set this instance up*,
which somebody notices in the first minute. The twenty-odd route tests that
build `AuthDeps` by hand are not testing setup, and requiring the field would
have edited all of them to say the same thing.

**The database gate stays.** The key narrows the window; the database closes it.
Two replicas would each print a different key and only one would work — which is
an argument for the database check remaining exactly where it is, not for
replacing it.

**The screen says where the key is, above the field that asks for it.** A field
for something one cannot find is a dead end with an input in it. The command
goes through the message catalogue like everything else, because a command in
the markup is English on a translated screen and the i18n guard is right to say
so.

## Consequences

Setting up an instance now takes one more step: a glance at
`docker compose logs sone`. That is the cost, and it is smaller than the
command-line account creation this replaces in the sibling project — and much
smaller than the database edit that recovers a hijacked first minute.

An operator who restarts before using the key gets a new one. The old one stops
working, which is the intended direction.

An automated deployment that wants to create the first account without a human
reading a log has no path here. That is a real gap and deliberately unfilled: a
key in the environment would be a permanent secret in `.env`, which is the thing
this avoids. If it is ever needed, it should arrive as its own decision with its
own reasoning, not as a convenience on top of this one.

`invalid_setup_key` joins `AuthError`'s codes and maps to 401, and the message
catalogue gains four keys in both languages.

## What this found in the other direction

Reading SONE's `bootstrapInstance` to answer the question found something
missing in SOTE's equivalent: SONE's advisory lock, with the comment *serialise
concurrent first-run attempts*, had no counterpart there. Without it, two
simultaneous setup requests carrying the same key and different addresses both
saw "no account", both accepted the key, and both created one — leaving an
instance with two owners, one of them unplanned. SOTE now takes the lock and
checks its condition inside it, and carries a test that runs two setups at once
against an empty database.

Which is the argument for reading a sibling's answer rather than assuming one's
own is the good one, in both directions.
