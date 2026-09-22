# ADR-0187: Push limits, and a test harness that tells the truth

## Status

Accepted. Built. The last two findings from the external review — F05 (push
subscriptions as an SSRF and fan-out surface) and F12 (the test harness and the
README describing something other than what the repository is).

## Context

### F05 — a push endpoint is a URL somebody chose

Web push works by the browser handing the server an endpoint URL to POST to when
there is something to wake it about (ADR-0180). The server posts to whatever URL
was registered, and the only check was that it is `https:`. Three consequences:

- **Blind SSRF.** The server will POST to a loopback, internal or otherwise
  unwanted address if the network and TLS allow it. It is *blind* — SONE's push
  carries no payload (RFC 8291 is not implemented), the response body is never
  read, and the only feedback is a 404/410 that deletes the subscription — so it
  is a weak primitive, well short of reading internal data. This is the
  restriction every web-push implementation lives with, because a browser gives
  out whatever push-service URL its vendor uses; it is a real risk but a small
  one, and P1 overstated it.
- **Redirects.** The default `fetch` follows a 3xx, which would send the POST
  somewhere other than where it was registered — the move an SSRF wants.
- **No timeout, no ceiling.** The fan-out is `Promise.all` over every
  subscription with no per-request timeout, so one slow endpoint holds a
  connection for undici's 300-second header default while the rest wait; and an
  account may register unlimited endpoints, so the fan-out one account can point
  outward is unbounded.

### F12 — the harness and the README described a different project

- `pnpm test` is documented to run without a database, skipping the DB suites.
  Five of them (`versions`, `emailNotifications`, `importExecute`, `inbox`,
  `jobs`) called `getTestPool()` in an unguarded `before` instead of skipping,
  so without `SONE_TEST_DATABASE_URL` they threw and `pnpm test` failed —
  against its own documentation.
- The server test scripts set `SONE_PASSWORD_COST=12` as a Unix env prefix,
  which cmd and PowerShell do not understand, so the suite could not start on
  Windows.
- One guard test asserted a `/`-separated path, which is a `\` on Windows, so it
  failed there for a reason unrelated to what it checks.
- The README's status line said "pre-alpha … Nothing runs", while the repository
  is at `0.12.8-dev`, has a CHANGELOG, a release process, published images and a
  CI pipeline that runs the whole suite on every push. The reviewer also
  reported finding no CI — because they looked in `.github`, and the pipeline at
  the time was Forgejo's, in its own directory. (It has since moved to
  `.github/workflows/`, which is where they looked.)

## Decisions

**Push: two limits on what the server does with an endpoint.** The fan-out fetch
gets `signal: AbortSignal.timeout(10s)` so one endpoint cannot stall the others,
and `redirect: 'error'` so a 3xx is refused rather than followed. Registration
caps an account at twenty devices; re-registering an endpoint the account already
holds is not a new device, so only a genuinely new endpoint past the limit is
refused.

**Push: no host allowlist.** The obvious "only allow known push services" would
break the case a self-hosting product must not break — Firefox with its own
autopush, and UnifiedPush endpoints a user runs themselves, are legitimate and
not on any vendor list. A denylist of loopback and private ranges was considered
and left out for the same reason: an instance whose push relay is on the internal
network is a real deployment. The timeout, the no-redirect and the per-account
cap are the fixes that do not assume where a valid endpoint lives.

**Harness: skip, do not throw, without a database.** The five suites are wrapped
in a `describe` guarded by `hasDatabase`, like the other sixty-one, so `pnpm
test` skips them cleanly on a machine with no Postgres and the documented command
does what it says.

**Harness: run on Windows.** `cross-env` sets `SONE_PASSWORD_COST` in the test
scripts so the prefix works in every shell, and the guard test's path assertion
accepts either separator.

**README: say what this is.** The status line now says pre-1.0 and running, with
CI, releases and images — and still warns that schema and documents may migrate
before 1.0, which is the part of the old warning that was true. The Testing
section states the skip-without-a-database contract and points at the CI
pipeline, so the next reader does not conclude there is no CI.

## Consequences

A single account can no longer aim an unbounded number of server-side POSTs, one
slow push service cannot delay the rest, and a push endpoint cannot bounce the
server through a redirect. `push.db.test.ts` asserts the fetch is made with
`redirect: 'error'` and an abort signal, and that a hanging endpoint is counted
as failed rather than awaited forever. A fresh checkout runs `pnpm test` on
Windows and Linux without a database, and a reader of the README learns the
project's real state and where its CI is.

The per-device cap has no HTTP route test — the push routes have no test harness
yet, and standing one up for a P3 ceiling was more than the finding warranted;
the cap is small and covered by type-checking and the ADR. Moving the import to a
worker thread so a large inflate cannot block the event loop, and an HTTP harness
for the push routes, are noted as follow-ups rather than built here.

## Alternatives considered

**A push host allowlist or private-range denylist.** Rejected above: both break
legitimate self-hosted and non-Chrome push, which is exactly the audience a
self-hostable product has.

**Reduce `SONE_PASSWORD_COST` for tests without an env prefix at all.** Would
avoid the `cross-env` dependency, but the cost is a real setting a test wants to
lower for speed, and threading it through code paths only for tests is more
surface than one well-understood dev dependency.

**Leave the README warning as it was.** "Nothing runs" is not cautious, it is
wrong, and a security reviewer who believes it audits the wrong thing — which is
what happened. The honest warning is the migration one, which is kept.
