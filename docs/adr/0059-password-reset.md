# ADR-0059: Resetting a forgotten password

## Status

Accepted. The token, its storage and its rules are built and tested; the two
routes, the screen and the mail are not. What is left is at the end.

## Context

Until this week the server had no way to send mail, so a forgotten password was
an administrator's problem: somebody asks, an administrator sets a new one out of
band. ADR-0058 gave the server an SMTP path, which makes a self-service reset
possible for the first time.

There is history here worth naming. `0004_auth` created a `password_resets`
table that no code ever touched — no route issued a token, none consumed one —
and it was dropped in `0046` rather than adopted, precisely so that this record
could decide the token's shape on purpose instead of inheriting a guess made
years earlier. The old table's columns are not evidence about what is right.

## Decisions

### A reset is a credential, and is stored like one

A random 32-byte token, given out once in a link, and stored **hashed** — the
same rule sessions follow (ADR-0010): the server does not keep the plaintext of
anything that grants access. A stolen database backup must not contain working
reset links.

### One hour, one use

Short, because the window is the whole risk: a link sitting in a mailbox is a
key to the account for as long as it works. One hour is enough to read a mail
and long enough to survive a delayed relay.

Consumed on use, and consumed on **success only** — a wrong new password (too
short, say) must not burn the link, or somebody who mistypes has to start again
from the mail.

### The answer is the same whether the address exists

"If that address has an account, a link is on its way." Always, for any input,
with the same timing envelope.

An honest form that says "no such account" is an account enumeration oracle: it
turns a list of email addresses into a list of members of this instance, which
for a self-hosted wiki can be a list of who works somewhere or who belongs to an
organisation. That is a disclosure the reset form has no business making.

### The mail says less than a notification does

A reset link, that it expires in an hour, and that the request can be ignored if
it was not theirs. No display name, no workspace names, no instance-specific
detail beyond the instance name somebody already knows they use.

A notification mail names a page because it must be actionable (ADR-0058). A
reset mail needs to be actionable about exactly one thing, and everything else it
could say is something an attacker who guessed an address gets for free.

### Resetting signs out everywhere else

Every other session for that account is revoked. Somebody resetting a password
either forgot it or fears somebody else has it, and in the second case leaving
the intruder's session alive makes the reset theatre.

The session doing the reset is not created either: the reset page ends at the
sign-in screen. A reset that logs you straight in is a link in an inbox that logs
somebody in.

### Rate limited on the existing mechanism

`auth_attempts` already records attempts by key and by IP prefix for sign-in.
Requests reuse it rather than growing a second limiter: two limiters are two
answers to "is this too many", and they drift.

### Absent when there is no relay

No SMTP settings, no "forgot your password?" link. An instance that cannot send
mail must not offer a reset that silently does nothing — which is what a queue
filling up would be.

## Consequences

One table, one column of it hashed, two routes, one screen with two states, and
a link on the sign-in page that appears only when mail works.

An administrator can still set a password out of band; this does not replace
that, and an instance with no relay is unchanged.

## Built so far

Issuing and redeeming, with the token stored as a hex SHA-256 digest and never
in plaintext, and every refusal the decisions above describe covered by a test:
an unknown address yields nothing, a single sign-on account yields nothing, a
rejected password does not burn the link, a link works once, an expired one says
*which* no it is, and a successful reset drops every session and voids the
person's other outstanding links.

**Using the primitives that already existed.** I wrote a `hashToken` here —
plain SHA-256, with a comment explaining why a KDF would be pointless for a
random token — and `password.ts` has had exactly that, plus `generateToken` and
`tokensMatch`, since ADR-0010. Two answers to one question is the thing this
codebase keeps having removed from it; a third, explained well, would have been
worse rather than better. The password policy is the existing
`assertPasswordAcceptable` too, so the sign-up form and this screen cannot
disagree about what a password must be.

## Still to build

The request route, the redeem route, the screen with its two states, the mail
itself, and the "forgot your password?" link that appears on the sign-in page
only when a relay is configured.

## What is deliberately not decided

**A reset that also unlocks single sign-on accounts.** An OIDC account has no
password here to reset; the reset form should say so rather than send a mail
that cannot help. Whether it says *which* provider is a disclosure question of
its own, and it needs the enumeration rule above thought through again.

**Second factors.** There are none yet. When there are, a password reset must not
be a way around them, which is a decision that belongs with the second factor
rather than here.
