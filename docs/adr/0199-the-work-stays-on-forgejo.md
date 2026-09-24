# ADR-0199: The work stays on Forgejo, GitHub is the shop window

## Status

Accepted. Built. Reverses the CI half of the publication change of 2026-09-23,
which was never written down as a record of its own — which is part of why this
one exists.

## Context

Publishing on GitHub (2026-09-23) moved three things at once: the source, the
container images, and the workflows that build them. Only the first of those was
the point.

Two days of running it that way produced:

- **A permanently red `Build image` on Forgejo.** The instance falls back to
  `.github/workflows/` and picked up a job that authenticates against ghcr.io
  with a token it does not have (ADR-0197 named it, and gated the job off).
- **Two registries, one of them empty of anything current.** `ghcr.io` carried a
  single `main` tag; the Forgejo registry carried the tags a running instance
  was actually pulling. `docker-compose.yml` had been pointed at the first,
  so the default in the repository named a place the deployment did not use.
- **A self-hosted runner documented out of existence.** `docs/actions-runner.md`
  lost the 184 lines describing the runner that still does all the work.

None of that was wrong to try. It is wrong to keep once it is clear that the
images and the runner never left home.

## Decision

**Both workflows live in `.forgejo/workflows/` and nowhere else.** Forgejo looks
in that directory first and stops there, so this is also what makes the single
copy possible: `.github/workflows/` is deleted, GitHub Actions runs nothing, and
there is one test workflow and one image workflow in the repository.

That is the shape ADR-0196 wanted and could not have — it kept the GitHub copy
and therefore needed two of everything plus a guard. With GitHub building
nothing, the guard has nothing to guard.

**Images publish to the Forgejo registry again**, with the `REGISTRY_TOKEN`
secret that is still configured, and `docker-compose.yml`, `.env.example` and
the deployment documentation point back at them. A default image address that
nobody publishes to is the same failure as a workflow that is always red: it
looks like an answer and is not.

**GitHub keeps the source.** The push mirror is configured and syncing on every
commit, which is the whole of what publication needs: somebody can read the
code, clone it, and open an issue. `docs/deployment.md` still tells them to
clone from there.

## Consequences

- Someone who clones from GitHub and wants a prebuilt image pulls it from
  `forgejo.thiel.tools`. Building it themselves stays documented, and
  `docker-compose.build.yml` still does it in one command. If the project ever
  wants images a stranger can pull without thinking, ghcr.io is the place and
  publishing to *both* is the change to make — deliberately, with something
  keeping the tags in step.
- Version tags now produce `X.Y.Z`, `X.Y` and `latest` on Forgejo again. The
  lone `main` tag on ghcr.io is left where it is: deleting a published image is
  a thing somebody may be pulling.
- CI runs only where the work happens. A pull request on the GitHub mirror
  would go unchecked — the mirror is one-way and does not take them anyway.

## What was not done

**A record of the original move.** The publication change of 2026-09-23 altered
the forge, the registry and the CI in one commit and left no ADR, so reversing
part of it meant reading the diff to find out what had been decided. That is
the cost this directory exists to avoid, and it was paid twice this week
(ADR-0196 as well).
