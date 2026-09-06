# ADR-0108: Two of them were one

## Status

Accepted. Built. The last item on `claude/durchgang-nie-gelaufen.md`, listed
there as "OIDC-Kleinkram" — three small things. One of them is not small, and
two of them are the same decision.

## Context

The list named three:

1. discovery runs twice per sign-in, uncached and without a timeout
2. an unknown `kid` fails the sign-in instead of refetching the keys
3. `settingsFor` answers `404 not_configured` for three different states

All three were confirmed true by ADR-0105's check. What that check could not see
is how they relate.

### (1) is not small

Node's `fetch` has no default timeout, and nothing bounded any of the three
outbound calls — discovery, the token exchange, the keys. A provider that
accepts the connection and then says nothing (a half-open firewall, an
overloaded identity server, a name that now resolves somewhere quiet) leaves the
request outstanding for as long as it likes, with the person on a blank page.

The token exchange is the worst place for it: by then the authorization code has
been handed over, so hanging there costs a code that cannot be used again.

The first version of the test for this did not fail. It **hung** — which is the
finding, stated more exactly than a description could.

### (2) and (1) are one decision

`verifyIdToken` has said this since ADR-0024:

> Providers rotate keys and publish the new one before using it, so an unknown
> `kid` means "fetch again", not "reject" — but that decision belongs to the
> caller holding the cache, and here it simply finds nothing.

There was no caller holding a cache. Every sign-in fetched the keys afresh, so a
rotation resolved itself on the next attempt and the sentence described a
problem nobody had.

**Caching the keys is what creates it.** Between a rotation and the entry
expiring, every sign-in would fail with `unknown_key` — a self-inflicted outage,
introduced by the obvious optimisation, in the component whose failure mode is
"nobody can sign in".

So the cache and the refetch ship together or not at all. That is the whole
finding of this round: the list said three things and one of them was a
prerequisite of another, which is not visible from either entry.

It is also the ADR-0101 shape one level further out. There, a fault was latent
because no caller reached it. Here, a fault is latent because an *inefficiency*
prevents it — and removing the inefficiency is what makes it real.

## Decisions

### Every outbound call is bounded

`PROVIDER_TIMEOUT_MS = 10_000`, applied to discovery, the token exchange and the
keys, each with its own error code so a log says which call did not come back.

Both an `AbortSignal` and a race, for the reason `LocalFileStore.checkWritable`
already gives about the same pairing: the signal is what actually releases the
socket, and the race is what makes the bound hold for a `fetchImpl` that ignores
it — which every test's does, and which is exactly where a bound that only looks
enforced would go unnoticed.

### `ProviderDirectory` holds what the provider said

Not to save a request. `/start` discovers, and `/callback` discovers **again**,
after the code has been handed over. A provider briefly unreachable at that
second moment costs somebody a spent code and a sign-in they have to begin
again with no idea why. Remembering the document makes the callback depend on
the provider being up once rather than twice.

An object rather than module-level state, so a test constructs its own and
watches what it asks — and so a second provider, if there is ever one, is a
second directory rather than a shared map.

### The refetch is the caller's, exactly once

`directory.keys(discovery, { refresh: true })` is asked for by the callback when
verification fails with `unknown_key`, and only then.

Not decided inside the directory, because an unknown `kid` is also what a forged
token looks like: a directory that refetched on its own would let anybody make
this server call its provider as often as they liked. The caller is the one that
knows it has already tried once.

This is precisely the arrangement `verifyIdToken`'s comment described. The
comment was not wrong; it was waiting.

### Three states, and only one of them is a fault

`standingFor` answers `ok`, `absent`, `disabled` or `no_secret`.

`absent` and `disabled` stay one answer — both mean "there is no sign-in here",
and neither is anybody's fault. `no_secret` gets `503 no_client_secret`, because
it is the one an operator can fix and the one that reads as the other two: it
happens when a container restarts without `SONE_OIDC_CLIENT_SECRET`, and then
the settings screen goes on saying *enabled*, the button disappears, and every
diagnostic says *not configured* about a provider that is configured.

`/config` keeps the collapsed answer on purpose. It is read by an anonymous
sign-in page, and which kind of not-configured this instance is, is nobody's
business until they are signed in — the same argument that route already makes
about not naming the issuer publicly.

## Consequences

**Nine tests, all nine failing before the change** — six on the directory and
timeouts, three on the three states. Two are counterweights: the directory never
refetches on its own, and `/config` still says only yes or no.

**A sign-in makes three outbound calls instead of four**, and the second half of
it makes none that can fail before the token exchange. That is the point; the
saved request is a side effect.

**`fetchKeys` and `discover` keep their exported signatures**, with the timeout
as a defaulted third parameter, so nothing that called them directly had to
change and the tests that exercise a misbehaving provider still do.

**`claude/durchgang-nie-gelaufen.md` is now empty of open points** except the
file orphan sweep, which is its own record.

## Alternatives considered

**Refetch the keys inside the directory on an unknown `kid`.** Fewer moving
parts, and it hands an unauthenticated caller a lever on this server's outbound
traffic: every forged token with a novel `kid` becomes a request to the
provider.

**Carry the discovery document in the sealed pending cookie**, so the callback
needs no cache and no second fetch. It works, and it puts three URLs in a cookie
on every sign-in, and it does nothing for the keys — which is the half that
actually repeats.

**Cache the discovery document only, and leave the keys uncached.** Half the
benefit and none of the danger, and it leaves the sign-in making a JWKS request
every time — the one call whose result changes least often. It also leaves
`verifyIdToken`'s comment describing a caller that still does not exist.

**A longer TTL.** Ten minutes covers a sign-in and forgets fast enough that an
endpoint change reaches this instance the same day. Anything much longer needs
the refetch to cover discovery too, and a provider that moves its token endpoint
is rarer than one that rotates a key.

**Leave the timeouts to a reverse proxy.** It bounds the *client's* wait and not
the server's socket, and it is a piece of somebody else's configuration that
this repository cannot test.
