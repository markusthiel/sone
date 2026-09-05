# ADR-0077: A check nobody reads

## Status

Accepted.

## Context

The test workflow failed on **295 consecutive runs**, from 2026-08-31 until
today, 2026-09-04. In that window eight pull requests were merged into `main`,
seven records were written, and version 0.11.0 was released.

The cause is one line:

```yaml
run: npx tsx scripts/check-version.mts
```

`tsx` is a devDependency of all five packages and of none of them at the root,
so a clean checkout has no `node_modules/.bin/tsx`. The runner answered
`sh: 1: tsx: not found` and stopped at step thirteen of twenty-one — before
typecheck, before the build, before a single test ran.

Three things made it invisible for five days, and each of them is worth naming
separately, because only one of them is a bug.

**It passed locally, for a reason that has nothing to do with this repository.**
`tsx` was installed globally in my working container, months earlier, by
something unrelated. `npx` puts the global bin directory on the path, so the
command resolved — to a binary no manifest here mentions. I ran that check
before every one of those eight merges and it printed
`9 case(s) ok` every time. A check that reads a machine rather than a
repository does not check anything; it reports on the machine.

**The failure looked like a pass.** Twelve mechanical checks come before this
one and all twelve went green, so the run was a wall of ticks with one cross
thirteen rows down. The honest signal was elsewhere and I never read it: a
healthy run of this workflow takes about **two and a half minutes**, and every
one of these took **twenty seconds**. The duration said "the tests did not run"
five days before anybody asked why.

**I never opened it.** I verified every one of those eight pull requests by
running `pnpm check` and the full suites in this container — thoroughly, and
each time on a fresh checkout of `main`. That is a good habit and it is not the
same habit as looking at CI. Local verification answers "does this work where I
am standing". CI answers "does this work anywhere else", which is the question
that matters, and it was answering *no* the whole time, out loud, on a page I
did not visit.

There is a smaller finding underneath. `docs/actions-runner.md` claimed the
image workflow built with buildah, needed no Docker daemon, and had its push
trigger disabled. All three were false — it uses buildx, it needs a daemon, and
it fires on every push to `main` and every version tag. I read that page while
cutting 0.11.0, believed it, and wrote in the release notes that no image could
be produced here. The runner was building one as I wrote it.

## Decision

**A tool a workflow runs must be installed by the workspace root.**
`scripts/check-ci-tools.mjs`, run from the test workflow itself, scans every
`run:` block for `npx`, `pnpm exec` and `pnpm dlx` and fails when the named
binary is not in the root `node_modules/.bin`. That directory is exactly what a
clean checkout gets from `pnpm install` and nothing outside the repository can
add to it, so it is the one place where the question "would this resolve
anywhere else" has a decidable answer. `pnpm dlx` is rejected outright: it
fetches from the registry by definition, so a build using it fails on the day
the registry is unreachable, which is the day you most want to build.

`tsx` is now a root devDependency, and the step uses **`pnpm exec`** rather than
`npx`. `npx` searching the global bin directory and then the registry is the
mechanism that let one machine disagree with every other one; `pnpm exec` takes
what the workspace installed and nothing else.

**Merging is conditional on the pipeline, not only on a local run.** The
verification habit recorded in earlier decisions — a fresh checkout, `pnpm
check`, the full suites — stays, because it catches things earlier and in more
detail. It is now explicitly not sufficient. Before a merge, the run for that
head commit must be **green**, and a `test.yml` run that finishes in well under
two minutes did not run the tests whatever colour it shows.

**A document about infrastructure is checked against the file it describes, or
it is deleted.** `docs/actions-runner.md` now matches the workflows, and says
what it got wrong, because the next person to read it deserves to know it was
wrong once for five days.

## Consequences

The 0.11.0 release notes and its commit message say an image could not be
produced here. That was wrong, and it is not corrected in place: a released tag
is not moved (ADR-0013), and its notes are what an operator running 0.11.0
reads. The correction sits under **Unreleased**, immediately above the notes it
corrects, and ships with the next release rather than in one of its own.

That was a deliberate choice against cutting `0.11.1` for it. Nothing in the
application changed here — CI, a document and the changelog — so a patch
release would have handed an operator a tag, an image and a "pull and restart"
whose result is byte-identical to what they already run. A version answers "what
must I do to upgrade?" (ADR-0013), and the honest answer to this one is
"nothing", which is not a release. Anyone reading the changelog meets the
correction one paragraph before the sentence it corrects.

Everything the 295 runs did not check has now been checked, on the same
machine, the same way as before: 2082 tests, typecheck and lint clean. That is
not the same as CI having been green, and this record does not claim it is. What
`main` has is a pipeline whose first green run in five days is the one that
merges this.

The check is narrow on purpose. It does not parse shell, and it will not catch a
step that calls a system tool the job image lacks — `pg_dump`, say, which this
project has already been bitten by once. That would need a general parse of
arbitrary shell, which is a large and wrong program. What it catches is the
specific class where a *package's* binary is asked for and the workspace was
never told to install it, which is what happened here and what would happen
again.

The uncomfortable half of this record is not the missing dependency. It is that
a signal was firing continuously, in a place built for exactly this, and the
person it was firing at had a good enough local habit to stop looking.
