# ADR-0082: Signing in was never tried

## Status

Accepted. Last of the audits argued for by ADR-0076 and ADR-0077. Amends
ADR-0024.

## Context

The cryptography of single sign-on is the best-tested code in this repository.
`oidcToken.test.ts` generates real RSA keypairs, signs real tokens, and breaks
them one property at a time across seventeen negative cases: `alg: none`, an
HMAC substitution, a wrong issuer, a wrong audience, an expired token, a missing
nonce, a token signed by a different provider. `oidcFlow.test.ts` drives
discovery, PKCE and the token exchange against a fake provider. Every security
question I put to this code came back with a citation and a passing test.

**And `oidcRoutes.ts` — the callback, the state comparison, the account linking,
the session issue — was imported by exactly one thing: `main.ts`.** No test
imported it. The file named `oidcRoutes.db.test.ts` did not import it either: it
made four `INSERT` statements and asserted what Postgres does with them, under a
docstring saying "Signing in through an identity provider, end to end… which
account it decides somebody is, and what it refuses."

ADR-0024 says the same, and is wrong about its own test suite: "Tests run
against a simulated provider… so discovery, PKCE, the state check, signature
verification, issuer and audience checks and clock skew are all exercised." The
state check is exercised as the bare `statesMatch` helper and never in the
callback that calls it. Nothing anywhere signed a real token *and* delivered it
through a route. ADR-0024's closing sentence — "this is the one area where that
would be worth catching late" — describes the gap it claims to have closed.

So I wrote that test. It found this in its first second:

**Signing in through a provider for the first time has never worked.**
`linkOrCreate` creates the account with `ON CONFLICT (email) DO NOTHING`. The
unique index on that table is `users_email_key ON users (lower(email)) WHERE
email IS NOT NULL` — an expression, and partial. Postgres infers an arbiter by
matching both, so that clause matches nothing and raises *"there is no unique or
exclusion constraint matching the ON CONFLICT specification"* on **every**
attempt to create an account.

The throw landed in the callback's single coarse `catch`, became `401
sign_in_failed`, and wrote nothing anywhere. From outside it is indistinguishable
from a forged token. An operator who configured OIDC correctly and pressed the
button got "sign-in failed", with no way to tell that from a provider problem, a
clock problem or a typo in the client secret.

Three more, none as severe:

**The pending cookie was unsigned.** State, nonce and PKCE verifier lived in
plain JSON in a cookie. The state comparison then proves the provider's response
matches *whatever pending blob the browser is carrying* — which is a real check
against a replayed or injected authorization response, and no check at all
against somebody who can write a cookie for this host. A sibling subdomain, or
plain HTTP where `secureCookies` is off, is enough to plant your own state,
nonce and verifier and complete a sign-in **into your own account** in somebody
else's browser. They then use SONE as you, and write into a workspace they think
is theirs.

**The pending cookie was never actually cleared on success.** `clearPending`
called `setHeader('set-cookie', …)`, then `setSessionCookie` called
`setHeader('set-cookie', …)` again — and `setHeader` replaces. So the clearing
cookie was discarded on the one path that matters, and the blob stayed in the
browser for its full ten minutes. The failure paths worked, because `ctx.fail`
merges what `setHeader` left behind, which is why the comment — "cleared
whatever happens next, so one attempt cannot be replayed" — reads as true.

**The coarse catch had no log.** A `TypeError`, a database outage inside
`linkOrCreate`, a failure to create the session: all `401 sign_in_failed`, all
silent. That is what turned a total feature failure into something nobody could
diagnose.

## Decision

**`ON CONFLICT (lower(email)) WHERE email IS NOT NULL`**, matching the index
that exists. Case-insensitive matching is also the better rule: an address that
differs only in case is the same address, and the local-account refusal now
holds for `Schon-Da@example.org` as well.

**The pending cookie is signed** with the instance secret — payload, a dot, an
HMAC — and compared in constant time. A browser cannot forge it; a test can
still read the payload, which is why the signature is separate rather than the
whole thing being encrypted.

**Cookies are appended, not set.** `addCookie` here and `setSessionCookie` in
the auth module both preserve what is already on the response. Nothing else sets
a cookie alongside these today, which is exactly why the collision went unseen.

**The catch logs anything that is not an `OidcError`,** because those are the
ones that mean something is broken here rather than wrong over there.

**`oidcRoutes.db.test.ts` now tests what its name says**: a provider issuing
real signed tokens, the routes, and a database. Seven cases — an account is
created and a session issued, the pending cookie is cleared, a mismatched state
is refused, a planted cookie is refused in both its signed-badly and
unsigned-old shapes, an unverified address creates nothing, a colliding local
address is refused rather than linked, a second sign-in reuses the account, and
a correctly signed token from a different provider is refused.

## Consequences

**Nobody has ever signed in to a SONE instance through a provider**, unless
their `oidc_identities` row was created by hand. That is worth stating plainly
in the release notes rather than describing this as an improvement.

The account-takeover refusal — the single line that stops whoever can set an
address at a provider from adopting an existing local account — has now been
executed. It was unreachable code in a file no test imported, resting on a
schema detail (`users.email` being unique) that this same audit found the
neighbouring statement had got wrong. Both are now checked by the same test.

**Two things ADR-0024 and `docs/single-sign-on.md` describe do not exist, and
are not built here.** Both say linking an existing account is "a deliberate act
by somebody already signed in" — there is no such route. The only
`INSERT INTO oidc_identities` in the codebase is reachable through fresh-account
creation, so **every pre-existing local user is permanently unable to use SSO**,
and the documented remedy is not there. That is a feature, with its own
decisions to make, and it belongs in its own record.

It also carries a second consequence worth writing down before somebody builds
it. ADR-0063 and ADR-0065 exempt an OIDC account from the second-factor
requirement because "it has no password here", and `requirement.ts` implements
that as `if (!account.hasPassword) return fine`. That holds today only because
`linkOrCreate` creates accounts with a null password and never links existing
ones. The moment a linking route exists, an account can have both — and the OIDC
callback issues a session directly, with no second-factor step, unlike the
password path which diverts to a ticket. Somebody with a password *and* a
confirmed second factor would sign in through the provider and bypass it. The
linking route and that gate have to be built together.

Still unexercised, named rather than fixed: discovery runs twice per sign-in,
uncached, with no timeout or `AbortSignal` on any of the three outbound calls, so
a hanging provider holds the request until Node's socket default; an unknown
`kid` fails the sign-in rather than refetching the keys, which the token module's
comment describes as the strategy; `settingsFor` returns null for three different
conditions and surfaces them all as `404 not_configured`, so an administrator
whose container lost `SONE_OIDC_CLIENT_SECRET` gets the same answer as one who
configured nothing.

The lesson is not "test the routes". It is that **the quality of the tests
around a thing says nothing about whether the thing has been tried.** This is the
best-tested cryptography in the repository sitting behind a route that could not
create an account, and the test suite's excellence was part of what made that
invisible: reading it, I would have said this feature was in good shape, and
ADR-0024 says exactly that in writing.
