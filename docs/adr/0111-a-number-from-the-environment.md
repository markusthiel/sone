# ADR-0111: A number from the environment

## Status

Accepted. Built. The last remainder on `claude/durchgang-nie-gelaufen.md`.

## Context

The note said: nothing asserts the *results* of `versionQuietDocuments` or
`pruneShareSessions`, and one of the maintenance job's ten tasks is a no-op
under test because no test passes a `sync`.

All three were true, and one of them was more true than it looked. The file is
called `maintenance.db.test.ts` and it tested **one** task — the retry. That is
worse than a file named for the task would have been: `maintenance` on the tin
is what stopped anybody asking where the other nine were, and the answer turned
out to be three different things.

| | |
|---|---|
| covered, at the function, in another file | purge, expire jobs, thin versions, compact |
| covered nowhere at all | prune share sessions, version quiet documents |
| called in every run and returning on its first line | revalidate connections |

Nothing had ever asserted a single count on the way from a function to the
report an operator reads. Four of the report's anomaly counts were checked; the
other thirteen fields were not.

## What the tests found

The three tasks work. The pass works. The finding is next to them.

### A number from the environment is not a number

Six settings are read straight out of `process.env` with `Number(...)`, and
each lands somewhere a bad value is expensive.

Two of the six were careful. `passwordCost` refuses anything outside 10–20.
`VERSION_RETENTION_DAYS` was clamped by **ADR-0080**, with a paragraph that
names this exact hazard:

> `SONE_VERSION_RETENTION_DAYS=0` made the predicate below `taken_at < now()`,
> which is every version there is […] A non-number was worse in a quieter way:
> `NaN` reached Postgres as the string "NaN days" and threw inside a task whose
> failures are swallowed.

The other four were written the obvious way, and the paragraph stayed in the
file where it was written. Verified against the real database rather than
reasoned about:

| setting | not a number | zero or below |
|---|---|---|
| `SONE_VERSION_QUIET_MINUTES` | `"NaN minutes"` → `22007` on every pass, so no page is ever versioned again | the cut-off moves into the future, so *every* changed document is quiet: a version of each, every five minutes |
| `SONE_EMAIL_DELAY_MINUTES` | the same throw inside `claimForEmail`, so no notification mail is ever sent | immediate, which is a legitimate choice and stays allowed |
| `SONE_JOB_RESULT_HOURS` | an Invalid Date, sent as `0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN`, rejected — **so the statement that records a finished job as done fails, and the runner marks work that succeeded as failed and retries it** | the export expires before anybody is shown the link |
| `SONE_DB_POOL_MAX` | a pool of NaN clients | a pool of none |

The third is the one to keep. An export runs perfectly, four times, and is
reported as broken — because of a typo in a setting about how long results are
kept. Nothing in that chain says "check the environment".

### The comment that made a failure disappear

`versionQuietDocuments` loops over candidate documents and catches per document:

```ts
} catch {
  // Reported by the job's own guard on the next pass if it persists.
}
```

The guard wraps this function. Anything caught in here never reaches it. A page
whose document does not load is therefore never versioned, and no report, log
line or anomaly count ever mentions it — ADR-0047's promise quietly not kept for
that page, for as long as the instance runs.

`compactBacklog`, the very next task in the same list, returns its failures and
the job already puts them in `report.errors`, with a comment (ADR-0080)
explaining why a silent failure there was wrong. Two functions with the same
problem, in the same file, one of which had solved it.

## Decisions

### `envNumber`, and a guard against the seventh caller

One helper in `src/env.ts` — `envNumber(key, fallback, { min, max, integer })` —
and all six readers go through it. The bounds live with the caller, because they
belong to the caller: zero minutes of email delay is a choice somebody can make,
zero days of version retention is "delete all history".

**It refuses rather than clamps.** Clamping `SONE_JOB_RESULT_HOURS=0` up to 1
would silently give an operator something they did not ask for and leave them
believing the setting works. The documented default, plus a line at startup
naming the variable and the value, gives them the same working instance and a
sentence to search for.

**It does not refuse to boot.** `config.ts` throws for `SONE_SECRET_KEY`, which
is right — there is no default for a key. Every one of these has a sensible
default, and an instance that will not start because somebody typed
`SONE_DB_POOL_MAX=ten` has turned a slow query into an outage.

`scripts/check-env-numbers.mjs` fails the build on `Number(process.env…)`,
`parseInt(process.env…)` and `+process.env…` anywhere in the server outside
`env.ts`. **ADR-0104 refused to write a script for a family with one member**,
and said what would change the argument: the number. This family had six, two of
them careful, and one of the two carrying a written explanation of the danger the
other four were in. Nobody applied it to the neighbours, because nothing asked.

### `versionQuietDocuments` returns its failures

`{ taken, failures }`, exactly like `compactBacklog`, and the job pushes each
one into `report.errors` with the same wording. Not a new mechanism — the
mechanism was there, four lines further down.

### The pass gets a fixture with something for every task

One test builds an expired session, a stale rate-limit row, an expired share
session, a workspace deleted sixty days ago, a page that has gone quiet, a
backlog of 201 updates, a finished job whose download nobody came for, a version
four hundred days old, two failed projections (one that can be read this time
and one out of attempts), a stale search row, an orphaned page, a misplaced
entry, a document with no page and a file with no row — and then asserts every
field of the report.

One fixture rather than ten tests, because what was missing is not a test per
task. Several have good ones against the function. What was missing is the step
between the function and the number an operator reads, and that step only exists
when the pass runs.

The interesting part of that fixture is what is kept **apart**: the busy page's
updates are seconds old so the versioning task does not also claim it, and the
healing page's document is readable so the retry can actually succeed —
`recovered` had never been anything but zero, because every fixture page in the
old file had no document at all.

## Consequences

**Twenty-four tests**, of which the nine on `envNumber` and its guard, and the
one on a document that cannot be read, fail without the change; the rest are the
coverage the note asked for and pass either way. That split is the honest
report: the listed item was a gap, and the gap was hiding something.

**A `SONE_*` number that is not usable now says so at startup** and the instance
runs on the documented default. Nothing else changes for a correctly configured
deployment — every current value passes its bounds.

**The maintenance file is named for what it tests again.** Ten tasks, a pass
that exercises all ten, and the two that nothing had ever run have tests of
their own.

**`claude/durchgang-nie-gelaufen.md` has nothing left on it.**

## Alternatives considered

**Write the tests and leave the settings alone**, which is what the note asked
for. It would have left four settings that turn a typo into an outage nobody can
diagnose, discovered while writing the tests and then written down as a note for
somebody else — which is the arrangement this whole list exists to end.

**Clamp instead of refuse.** Quieter, and it makes the setting a lie: the
operator asked for 0 and the instance uses 1 while every screen agrees with
them. ADR-0080 clamped, and this differs from it deliberately; the clamp was the
right call when the alternative was deleting all history, and the refusal is
better now that there is somewhere to say so.

**Validate them in `config.ts` with the rest.** The natural home, and these are
read at module import by the files that use them, so moving them into the config
object means threading a value through four call chains to reach a constant. The
helper is the smaller change and puts the rule in one place either way.

**A lint rule instead of a script.** `no-restricted-syntax` would express this
in the eslint config and be enforced where people already look. It would also
make the failure a lint error among other lint errors, rather than a check whose
message can explain what `Number('ten')` does to a timestamp column — and this
project's evidence is that the explanation is the part that was missing.

**Let `versionQuietDocuments` throw on the first bad document.** Simpler, and it
means one unreadable page stops every other page on the instance from being
versioned. The loop is right; only the silence was wrong.
