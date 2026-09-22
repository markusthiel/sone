# CI

Two workflows exist and they have different jobs:

| Workflow | What it does | Triggers |
|---|---|---|
| `test.yml` | fourteen mechanical checks, typecheck, build, the full suite against a real Postgres, the migration chain from an empty database, and a boot-and-shutdown check | push to `main`, every pull request |
| `build-image.yml` | builds the container image, verifies it, then publishes it to ghcr.io | push to `main`, tags `v*`, manual |

Both run on GitHub-hosted runners and need nothing configured. In particular
there is **no secret to set up**: the image push authenticates with the token
Actions issues to the run, which is why the job declares
`permissions: packages: write`.

`test.yml` is the one worth having. `build-image.yml` is an optimisation, not a
requirement — `docker-compose.build.yml` builds on the deployment host and needs
no CI at all.

## A red pipeline is only useful if somebody looks at it

`test.yml` failed on **two hundred and ninety-five consecutive runs**, over five
days, through eight merged pull requests and a release, on one line:
`npx tsx scripts/check-version.mts` with no `tsx` at the workspace root. The
failure was thirteen steps in, so every check before it went green and the job
took twenty seconds instead of two and a half minutes — which is the only signal
anybody would have seen without opening it.

Two things came of that, and they are both in the repository rather than here:
`scripts/check-ci-tools.mjs` makes that class of mistake fail loudly and
immediately, and ADR-0077 records why the review habit has to change too. **The
duration is the tell.** A `test.yml` run that finishes in well under two minutes
did not run the tests.

## The image is checked before it is published, not after

`build-image.yml` builds with `load: true` rather than `push: true`, inspects
the result, and only then logs in and pushes. The order is the point: pushing
first would make a bad image briefly the published one — and for a version tag
permanently, because a released tag is never moved (ADR-0013).

What it checks has all been wrong at some point in this project: a missing
server entry point, a missing web build, a dropped healthcheck, a version that
was not baked in, and a container that would have run as root because the
entrypoint's handover to uid 10001 never happened. The last one is checked by
running the real entrypoint and asking the process who it is — an image can
declare a non-root `USER` and still be started as root, and a correct `USER`
line says nothing about what the entrypoint does afterwards.

## Verifying it works

Push any commit to `main`. The workflow should build and publish
`ghcr.io/markusthiel/sone:main`. Then:

```sh
docker pull ghcr.io/markusthiel/sone:main
```

**Check the package is publicly readable**, under the repository → Packages →
the image → Package settings → Change visibility. A package on ghcr.io starts
private no matter what the repository's visibility is, and stays private until
somebody changes it — and then `docker compose up` fails for everyone except
you, with an authentication error rather than anything informative.

Anonymous pull is the part that is easy to get wrong, so check it without
credentials:

```sh
tok=$(curl -s "https://ghcr.io/token?service=ghcr.io&scope=repository:markusthiel/sone:pull" \
        | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -H "Authorization: Bearer $tok" https://ghcr.io/v2/markusthiel/sone/tags/list
```

## Deploying from an image

Use `docker-compose.yml` rather than `docker-compose.build.yml` and set
`SONE_IMAGE` to a released tag — `ghcr.io/markusthiel/sone:0.11.0`. That
trades a multi-minute build on the deployment host for a pull. `:main` is the
development branch and is not for production; `:latest` never points at a
pre-release.

## If a job fails to start

1. Actions are disabled for the repository. Settings → Actions → General.
2. A fork's pull request gets a read-only token by default, so the image job
   cannot push. That is intended: the test workflow is what a fork needs.
3. `permissions: packages: write` was dropped from the image job. The symptom
   is a 403 at the push step, after a successful build — which reads like a
   credentials problem and is not.

## Note on history

Until this repository moved to GitHub, CI ran on a self-hosted Forgejo instance
and its workflows lived in a `.forgejo/workflows/` directory. Three things were true there
and are not here, which is why the workflow files are shorter now: the automatic
Actions token could not write packages, so a hand-made `REGISTRY_TOKEN` secret
was required; there was no Actions cache service, so the build ran without a
layer cache; and the runner was a long-lived machine that filled up with the
images each run loaded, so every run ended with a cleanup step. A
GitHub-hosted runner is a fresh VM that is discarded when the job ends.
