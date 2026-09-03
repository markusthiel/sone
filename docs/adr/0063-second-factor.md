# ADR-0063: A second factor

## Status

Accepted. Nothing built yet.

## Context

ADR-0059 built a password reset and deferred second factors with a condition
attached: when they exist, **a reset must not be the way around them**. That
condition is most of what makes this record non-obvious, and it is decided here
rather than there because it belongs with the factor.

An instance holds a company's notes. The realistic attack is not somebody
breaking scrypt; it is a password that was reused on a forum that got breached.
A second factor is the answer to that specific thing and to almost nothing else,
which is worth remembering when deciding how much apparatus it deserves.

## Decisions

### Time-based codes, and nothing else for now

TOTP (RFC 6238), six digits, thirty seconds. Every authenticator app supports
it, it needs no network, no phone number and no vendor, and an offline
self-hosted instance can use it — which SMS and push both fail.

Passkeys are better and are deliberately not decided below. SMS is not deferred,
it is refused: it is a second factor that a phone company can hand to somebody
else.

### The secret is encrypted, not hashed

A TOTP secret has to be recoverable to check a code, so it cannot be hashed like
a password. It is encrypted with `SONE_SECRET_KEY` instead.

That does not protect against somebody who has both the database and the
environment — nothing does. It protects against the realistic case: a database
backup on a laptop, a dump in a ticket, a restored staging copy. The same
reasoning that keeps the SMTP password out of the table (ADR-0058).

### Enrolment is not finished until a code is proved

The secret is created, shown as a QR and as text, and stored **pending**. It
becomes real only when the person types a current code.

Otherwise somebody who mis-scans, or whose phone clock is wrong, has locked
themselves out of their own account and does not find out until tomorrow. The
proof is the difference between a security feature and a trap.

### Ten recovery codes, shown once, stored hashed

They are credentials, so they are hashed like session tokens (ADR-0010) — a
stolen backup contains no working codes. Single use. Shown once at enrolment,
with a plain warning that they will not be shown again.

Regenerating replaces all ten, because a set where some are spent and some are
not is a set nobody can reason about.

### A password reset does **not** clear the second factor

This is the condition ADR-0059 attached, and it is the whole point: if resetting
a password removed the second factor, then anybody with access to a mailbox
would have access to the account, and the second factor would protect nothing.

So after a reset, signing in still asks for a code. Somebody who has lost both
their password and their phone needs a recovery code — and if those are gone
too, an administrator has to remove the factor, which is an act by another human
and is recorded.

That is deliberately not self-service. **A self-service way around a second
factor is not a second factor.**

### Sign-in is two steps, and the first one still costs what it costs

Password first, then the code. The password is verified fully — including its
scrypt cost — before the code is asked for, so the second step cannot be used to
learn whether a password was right.

Code attempts are rate limited on `auth_attempts`, the same mechanism sign-in
and the reset use. A code is single-use within its window: a code that has been
accepted cannot be accepted again, or somebody reading it over a shoulder has
thirty seconds to use it too.

One step of clock skew either side, and no more. Thirty seconds of tolerance is
a wrong clock; five minutes is a longer window for a stolen code.

### Turning it off needs the password, not just a session

An open laptop should not be enough to remove somebody's second factor. The same
goes for regenerating recovery codes, which is the same act with more steps.

## Consequences

One table, three routes, two screens, and a branch in sign-in. An administrator
gains one action they will use rarely and remember for the rest of their life the
first time somebody's phone falls in a lake.

Nothing changes for anybody who does not turn it on, and nothing about single
sign-on: an OIDC account authenticates at the provider, which has its own second
factor and is the right place for it.

## What is deliberately not decided

**Passkeys.** Better than TOTP in every way that matters and a bigger feature:
attestation, resident keys, multiple authenticators per account, and a recovery
story of their own. They deserve a record rather than an afternoon.

**Requiring it instance-wide.** An administrator being able to say "everybody
here must have one" is reasonable and is a policy question — what happens to
somebody who has not enrolled, whether they can still read, how long they get.
None of that is decided by adding a flag.

**Remembering a device.** "Do not ask again on this browser" is a cookie that is
a second factor, and deciding how long it lives and what invalidates it is its
own argument.
