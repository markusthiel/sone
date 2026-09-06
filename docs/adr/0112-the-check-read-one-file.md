# ADR-0112: The check read one file

## Status

Accepted. Built. A consequence of ADR-0111, found while writing its
documentation.

## Context

ADR-0111 gave six numeric settings bounds and a helper. Writing them into
`.env.example` meant reading what was already there, and four of the six were
not mentioned anywhere an operator looks — not in `.env.example`, not in
`docs/deployment.md`.

The two that *were* documented turned out to be worse than the four that were
not.

```
$ grep SONE_PASSWORD_COST docker-compose.yml
$ grep SONE_VERSION_RETENTION_DAYS docker-compose.yml
$
```

Compose does not forward the host's environment. A variable that the service's
`environment:` block does not name never reaches the container, whatever an
operator put in `.env`. So `SONE_PASSWORD_COST`, which `.env.example` invites
with a paragraph about what raising it costs, and `SONE_VERSION_RETENTION_DAYS`,
which `docs/deployment.md` names as the knob for how long history is kept, did
nothing at all in a Compose deployment.

That is precisely the fault `scripts/check-env-reaches-container.mjs` exists to
prevent. Its own first line says so: *every variable the server reads is named
where an operator can set it.* It has been green throughout.

## Why it was green

```js
const config = await readFile('packages/server/src/config.ts', 'utf8');
const read = [...config.matchAll(/'(SONE_[A-Z0-9_]+)'/g)] …
```

It reads one file. `config.ts` is where most settings are parsed, and it is
where the original fourteen were found, so it is where the check looked. Six
more are read at import time by the modules that use them — a password cost in
`auth/password.ts`, a retention window in `doc/versions.ts`, a quiet window in
`maintenance/job.ts`, a delay in `jobs/emailNotifications.ts`, an expiry in
`jobs/runner.ts`, a pool size in `db/pool.ts` — and this check had never seen
any of them.

The exception list makes it sharper. It carried:

```js
  // The test suite's own knob. A running instance should not set it, and a line
  // in compose is an invitation to.
  'SONE_PASSWORD_COST',
```

A named exception, with a reason, for a variable the reader had never produced.
It excused nothing and read like it did — and its reason was contradicted by
`.env.example`, which had been inviting the setting in a careful paragraph the
whole time. Two files, two answers, and the file operators actually copy was the
one that lost.

**This is the same shape as ADR-0111's**, one level up: there, a clamp written
for one constant stayed in the file where it was written. Here, a *check*
written for one file stayed on the file where it was written. The fix stays
where it was found, and what makes it stay is that nothing is looking anywhere
else.

## Decisions

### The check reads the whole server

Every `.ts` under `packages/server/src`, for `SONE_…` in single quotes. That is
how all of them are read — `process.env['X']`, or a helper taking the name — and
prose in this repository uses backticks, so a variable that is *talked about*
(the `SONE_S3_*` names, which ADR-0107 removed and left in a comment explaining
the removal) is not mistaken for one that is read. There is a test for that
line, because it is the cost of the wider reach.

The sanity floor moves with it: the check refuses to pass if it finds fewer than
25 names, where it used to refuse below 15. A reader that silently stops
matching is how this kind of guard becomes decoration.

### All six are forwarded

Including `SONE_PASSWORD_COST`, reversing the exception above. The argument for
keeping it out — that a line in compose is an invitation to lower it — describes
an invitation that already exists one file over, and the guard against a
weakened cost is the startup warning and the maintenance-panel anomaly that
ADR-0010's amendment added, not the absence of a line in a YAML file.

### And the check can be pointed at a tree

`process.argv[2]`, like `check-rights-enforced.mjs` takes a declaration path, so
a test can build a small tree and watch this fail. Five tests: a variable compose
does not forward, a variable the example does not mention, one read in a nested
module (the case that was missing), a name that only appears in a comment, and
the real repository.

## Consequences

**Six settings work that did not.** For a Compose deployment this is a
behaviour change: an operator who had `SONE_VERSION_RETENTION_DAYS=365` in
`.env` and was silently getting 90 will now get 365. That is what they asked
for, and it is worth saying out loud in the release notes rather than only here.

**Five tests, all five failing before the change** — three of them fail against
the old script because it never looked at the file they put the variable in.

**The check's floor is a count that moves.** It says 25 today and the repository
has 29. That gap is deliberate slack; a change that drops it below 25 should
have to think about why.

## Alternatives considered

**Leave `SONE_PASSWORD_COST` out and remove it from `.env.example`.** Coherent,
and it makes the cost unsettable in the deployment this project actually ships,
which is a real decision hidden inside a tidy-up. The setting has a warning and
an anomaly attached to it for exactly this reason.

**Have compose forward the whole environment** (`env_file:` plus no explicit
list). One line, and every future variable works by default. It also means a
typo in `.env` is silently ignored rather than visible in a diff, and the
explicit block is the only place where "what this service is configured with" is
written down.

**Generate the compose block from the source.** The check would become
unnecessary because the file would be derived. It also makes `docker-compose.yml`
— the file operators edit, fork and read first — a build artefact, which is a
bad trade for a list that changes twice a year.

**Read the variables from a single registry in the source** instead of scanning.
Cleaner, and it is the same move ADR-0111 made for the bounds. The difference is
that a registry has to be imported to be read, so the check would have to run
TypeScript; every other check in this repository reads files and runs nothing,
and that property is why they are quick enough that nobody turns them off.
