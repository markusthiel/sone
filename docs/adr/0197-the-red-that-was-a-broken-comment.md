# ADR-0197: The red that was a broken comment

## Status

Accepted. Built. Supersedes [ADR-0196](0196-two-forges-two-checkouts.md), whose
change is taken back out.

## Context

ADR-0196 read six red CI runs as a check-out problem: pull-request runs died in
about a minute, the same tree was green as a push, and the workflow had just
been ported from a hand-rolled `git clone` to `actions/checkout@v4`. It restored
`.forgejo/workflows/test.yml`, added `scripts/check-workflows-in-step.mjs` to
keep the two copies in step, and treated its own merge as the experiment: green
would mean the check-out, red in the same 55 seconds would mean the runner.

The restored workflow went green. That looked like a confirmation. It was a
coincidence: the pull request that carried it did not carry the actual fault.

The fault was in ADR-0195's own commit. Its new paragraph was written *after*
the closing `*/` of the comment above `.block-menu-action.current`, so from line
5153 `styles.css` held bare prose. postcss stops there with `Unknown word In`,
`vite build` fails, and `pnpm -r build` with it — one minute in, before any test
and long after the check-out.

Every red run contained that commit. Every green one did not. Nothing about the
event, the forge or the runner ever entered into it.

What hid it for six runs is worth recording, because it will hide the next one:
**typecheck, lint, all fourteen guards and the 1209 web tests read that file
without parsing it.** `pnpm -r build` is the only thing in the repository that
does, and it was the one command not run locally before pushing. The CI job
said so on its first attempt; the logs were never read, because Forgejo's API
has no endpoint for them and the web route needs a session.

## Decision

**ADR-0196's change is reverted.** `.forgejo/workflows/test.yml`,
`scripts/check-workflows-in-step.mjs` and the step that ran it are removed, and
`.github/workflows/test.yml` is again the only test workflow. Forgejo falls back
to `.github/workflows/` when `.forgejo/workflows/` is absent, which is how runs
1633 and 1640 reached the build step and failed there on the CSS — the GitHub
workflow was doing its job on Forgejo the whole time.

Keeping it would mean two copies of a two-hundred-line file, a guard to hold
them together and two edits per change, bought against a problem that never
existed.

**ADR-0196 stays, marked Superseded.** It is the more useful half of this
record: it shows what a plausible diagnosis built on timings looks like from the
inside, and that a green run after a change is not evidence the change caused
it.

## Consequences

- One test workflow again, `actions/checkout` on both forges.
- The open question ADR-0196 inherited — whether SONE's `test.yml` is green on
  the `docker5` runner (`claude/zwei-runner-ein-label.md`) — is still open, and
  is *still* not what any of this was about.
- A CSS syntax error costs a full CI run to find. A parse check over
  `styles.css` would catch it in a second, and is the guard worth adding if this
  happens twice. It is not added now: one occurrence is a mistake, and the
  repository already has fourteen guards, each of which was written after the
  second time.

## What was not done

**Reading the logs before deciding.** ADR-0196 named this under "what was not
done" and decided anyway. That is the actual lesson here, and it is not about
CI: the evidence that would have settled it in a minute was known to be missing,
and the decision went ahead on timings instead of stopping to ask for it.
