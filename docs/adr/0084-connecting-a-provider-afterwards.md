# ADR-0084: Connecting a provider afterwards

## Status

Accepted. Builds what ADR-0024 described and did not build; completes ADR-0082.

## Context

The ordinary way somebody arrives at a SONE instance is an invitation. They are
invited, they set a password, they use it — and *then* the instance gets a
provider configured, or they decide they would rather use the company's one than
remember another password.

Until now that was impossible. The only `INSERT INTO oidc_identities` in the
codebase was reachable through fresh-account creation, so a provider identity
could only ever be attached to an account the provider itself had made.
**Everybody who already had an account was permanently unable to use single
sign-on**, and no screen said so.

Three places describe a linking flow that does not exist. ADR-0024: linking an
existing account is "a deliberate act by somebody already signed in".
`oidcRoutes.ts` says the same in the comment above `linkOrCreate`, as the reason
matching is on `(issuer, subject)` and never on email. `docs/single-sign-on.md`
repeats it. All three are correct about the *rule*; none of them was a
description of the product.

That is the fourth record in this audit series to describe something unbuilt
(ADR-0024's tests, ADR-0044's administration entry, ADR-0058's retries and
unsubscribe header, `backup.ts`'s orphan report). The pattern is consistent
enough to name: **a record written before the work reads afterwards as a
description of the work.**

## Decision

**One route, two ways in.** `GET /api/auth/oidc/start` is a sign-in without a
session and, with `?link=1` and a session, the beginning of a link. Everything
up to the callback is identical — discovery, the three secrets, the redirect —
and the only difference is a field in the sealed blob. Two routes would be two
copies of the part that has security in it.

`?link=1` without a session is **refused**, not quietly downgraded to a sign-in.
The two do different things, and guessing which was meant is how somebody ends
up with an account they did not want.

**The session is checked again at the callback, and must match.** The blob says
whose attempt this is; the cookie says who is holding the browser. Both have to
agree. Without that, a link finished in somebody else's browser would attach
your provider identity to their account — and your provider is then a door into
it. This is the reason the blob is signed at all (ADR-0082); an unsigned one
would make the check circular.

**An identity that already belongs to somebody here is refused, not moved.** The
insert is `ON CONFLICT (issuer, subject) DO UPDATE … WHERE user_id = mine`, so
re-linking your own is idempotent and linking somebody else's returns no row.
Taking an identity off an account that is using it is not this route's decision
to make. A *second* identity at the same issuer for one account is refused
separately, by the unique index that has been there since migration 0016 — a
different sentence to the person ("you already have one connected") and worth
distinguishing.

**Disconnecting is refused when it is the only way in.** An account created by
the provider has no password, so removing the identity would close the door from
the inside with nobody outside it. The interface is told before it offers the
button, and the route refuses regardless.

**An OIDC sign-in still issues a session directly, with no second-factor step —
and that is the recorded rule rather than an omission.** ADR-0082 raised this as
a consequence to settle before linking existed, and settling it means reading
ADR-0065's own argument for the exemption: "an OIDC account authenticates at the
provider, which has its own second factor and is the right place for one.
Requiring TOTP of such an account would be requiring a second factor on top of
somebody else's first one."

That argument is about the **door**, not about the account. It holds just as well
for an account that also has a password: the password door still asks for the
second factor, and the provider door still trusts the provider. Both are honestly
guarded, by the party that did the authenticating.

The requirement side needs no change and was never wrong: `standingOf` asks
whether the account has a password *here*, and a linked account does — so it is
still required to enrol, which is right, because the password door is still
open.

## Consequences

**The trade belongs to the person who linked, and it is real.** An attacker who
takes their provider account gets in without their TOTP. That is the trade every
"sign in with…" makes, and it is chosen deliberately by somebody already signed
in rather than imposed. An instance that does not want it should not configure a
provider.

An administrator who turns on the second-factor requirement will still see
people unaffected — those with no password here — and the administration screen
already says so next to the setting (ADR-0065). What it does not say is that a
*linked* account is affected. It should; that is a wording change to the
administration screen and is not made here.

One provider per instance is still assumed, in the settings table and in this
screen. Several would change what "connected" means in the interface and what
`?link=1` has to carry, and it is not a thing anybody has asked for.

The screen is under **Deine Einstellungen → Anmelden**, beside the password and
the second factor, and renders nothing at all when the instance has no provider
configured: an empty section headed "single sign-on" is a thing to wonder about
rather than a thing to use.
