# ADR-0183: A requirement enforced at one door of many

## Status

Accepted. Built. Second of the fixes from the external review of `main` at
`8056a44` (the first four are ADR-0182); this is finding F02, kept separate
because it is a different shape — not a wrong check, but a right check in only
one place.

## Context

An instance can require a second factor (ADR-0065). Past a deadline, an account
that has a password and no confirmed factor is *blocked*: it may reach the
enrolment, session and logout routes and nothing else.

The block was enforced in `requireSession`, and only there. `requireSession`
guards `/api/me`, the session list, favourites and a handful of settings routes.
It does **not** guard the page tree, a page's content over sync, search, export,
file download, or comments — those resolve the caller through
`resolveSessionClaims` (directly, or through `claimsFor` / `claimsForRequest` /
the sync server's `handleAuth`), which never asked about the requirement.

So a blocked account, holding a still-valid session, saw an enrolment screen in
the client and could read and write everything behind it with a direct API or
WebSocket call. The block was a screen, not a rule. `requirement.ts` says in its
own words that "everything else — including reading — is refused"; it was not.

This only bites an account that has not enrolled after the deadline. An account
that *has* a factor never gets a full session until it completes the second step
at login, so there is nothing to misuse. But "the honest users are fine" is not
the property a security requirement is supposed to have.

## Decision

**Enforce the requirement where every authenticated path already converges:
`resolveSessionClaims`.** A blocked account resolves to no claims, which every
caller already turns into a refusal — 401/403 on HTTP, `auth failed` on sync.
The client still learns *why* from `/api/auth/session`, which goes through
`requireSession` and keeps returning the named `second_factor_required` code, so
the enrolment screen is unchanged.

The gate is also applied in `revalidateClaims`, so a requirement that comes into
force — or a deadline that passes — closes a live connection at its next
revalidation rather than only refusing the next new one.

**The gate slot moves to `auth/secondFactorGate.ts`.** It was a mutable
reference inside `http/auth.ts`, and `auth/claims.ts` is a layer below `http/`
and cannot import upward. The slot now lives below both; `http/auth.ts` and
`auth/claims.ts` both read it, `main.ts` installs the same closure into it as
before. Nothing about *what* the gate decides changed — only which layer holds
the reference.

The enrolment, session and logout routes stay reachable because they do not go
through claims at all — they use `requireSession`, whose own gate call lets those
paths through via `reachableWhileBlocked`. The claims resolver has no such
exception to make, so it passes an empty path, which matches none of the allowed
prefixes and is therefore refused like everything else.

## Consequences

A blocked account can no longer read or write through search, export, files,
comments, the page tree, or sync — new connections and existing ones alike. The
cost is one settings read (cached, ADR short-lived) and one small query per
claims resolution, and only while the requirement is switched on; with it off
the installed gate returns null before touching the database.

There was no end-to-end test of the block, which is why the hole lasted —
`requirement.test.ts` unit-tests `standingOf`, and `secondFactor.db.test.ts`
covers enrolment and codes, but nothing asserted that a blocked account is
actually refused. `auth.db.test.ts` now installs a gate that blocks one account
and asserts `resolveSessionClaims` returns null for it and resolves again once
the block is lifted — the enforcement point itself, independent of the settings
wiring.

## Alternatives considered

**Add the check to each un-gated route.** That is the arrangement that produced
the hole: a rule enforced route by route grows a gap the day somebody adds a
route. `check-rights-enforced` guards page-level rights this way, but a
cross-cutting requirement belongs at the one function all the routes share.

**Leave sync alone and gate only HTTP.** Sync is where the document content is,
which is most of what the requirement is meant to protect. `handleAuth` resolves
through the same function, so gating the resolver covers it for free; carving it
out would have been more code for a worse result.

**Return the named `second_factor_required` code from the resolver too.** The
resolver has callers that must not leak *why* access failed (a share route must
not distinguish "wrong password" from "blocked account"), so it returns the same
null it returns for every other refusal. The reason is available on the one
route whose whole job is to report it.
