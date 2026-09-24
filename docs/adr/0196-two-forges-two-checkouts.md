# ADR-0196: Two forges, two check-outs, one guard

## Status

Accepted. Built. Restores for Forgejo what the move to GitHub Actions removed,
without giving up the GitHub workflow.

## Context

Publishing on GitHub (decided 2026-09-23) ported `test.yml` to GitHub Actions
and deleted `.forgejo/workflows/`. The port replaced a hand-rolled `git clone`
with `actions/checkout@v4` and said why: on GitHub the action is first-party, so
cloning by hand buys nothing.

What nobody noticed is that the work still happens on Forgejo, and deleting
`.forgejo/workflows/` did not delete the *checks* — Forgejo falls back to
`.github/workflows/` — it changed which check-out step runs there.

The symptom, one day later, on PR #140:

| Run | Event | Tree | Result |
|---|---|---|---|
| 1639 | `push` on `main` | `6f3b9da` | green, 4m13s |
| 1633 | `pull_request` | the same tree plus one CSS rule | red, 1m1s |
| 1640 | `pull_request` | identical, re-pushed | red, 55s |

The same tree, green as a push and red as a pull request, twice, at a duration
that lands around the end of the tool install and nowhere near a test. Every
green pull-request run in the repository's history — #135 through #139 — is from
before the port.

Two candidates were held open, because Forgejo's job logs are not reachable
through its API and the evidence is circumstantial either way:

- **`actions/checkout@v4` on the pull-request ref**, resolved through this
  instance's actions mirror, which is exactly the dependency the deleted file
  was written to avoid.
- **The runner lottery** (`claude/zwei-runner-ein-label.md`): two global runners
  share the label `ubuntu-latest`, and SONE's `test.yml` has never been proven
  on `docker5` — that document lists it as open.

## Decision

**`.forgejo/workflows/test.yml` comes back**, byte-identical to the GitHub copy
except for the check-out step, which clones by hand as it did through five green
pull requests. Forgejo prefers `.forgejo/workflows/` when it exists, so the
GitHub copy stops running there and keeps `actions/checkout` for the forge where
it is first-party.

This also settles the open question rather than arguing it: if the restored file
is green, the check-out was the difference; if it is red in the same 55 seconds,
the runner was, and the fix belongs in `build-image.yml`'s shape instead.

**A guard holds the two copies in step**: `scripts/check-workflows-in-step.mjs`
compares them with the check-out step cut out, and asserts that the GitHub copy
uses `actions/checkout` and the Forgejo copy does not. It runs in both
workflows and in `pnpm check`.

Copying a two-hundred-line file is the part of this that is wrong. It is
accepted because the alternative — one file that branches on the forge — needs a
conditional that neither runner has, and because the failure mode of drift is
specific and catchable: a guard added on one forge and not the other, found on
the day it would have mattered. That is what the script is for.

## Consequences

- A change to the test workflow is now two edits. The guard fails the build if
  you make one, which is the intended trade: noisy in the small, quiet in the
  large.
- Forgejo no longer runs `build-image.yml` at all, since it only looks in one
  directory. That workflow has been red on Forgejo for every tagged release
  anyway — it pushes to the registry the GitHub move replaced with ghcr.io —
  so nothing that was working stops. Worth deleting, separately, once images
  are confirmed to come from GitHub.
- If a third forge ever appears, the copy-and-guard shape does not scale and the
  conditional check-out becomes the cheaper answer.

## What was not done

**Reading the logs.** Forgejo's API exposes run status but not job logs, and the
web endpoint that has them wants a session. The decision above is made on
timings and on which runs were green, which is weaker evidence than a log line
and was worth saying out loud.
