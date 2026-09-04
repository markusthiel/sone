# Forgejo Actions runner

Two workflows exist and they have different requirements:

| Workflow | Needs | Triggers |
|---|---|---|
| `test.yml` | a runner, and a job container plus a Postgres service | push to `main`, every pull request |
| `build-image.yml` | a runner **with Docker daemon access** | push to `main`, tags `v*`, manual |

**This page described a state that never shipped.** It said `build-image.yml`
built with buildah, needed no daemon, and had its push trigger disabled. None of
that is true of the file in this repository: it uses `docker/setup-buildx-action`
and `docker/build-push-action`, it runs `docker inspect` and `docker run` to
verify the image before publishing, and it fires on every push to `main` and
every version tag. A document that is confidently wrong about what a workflow
needs costs somebody an afternoon; this one cost a release being cut with
"no image is possible here" written in the notes, while the runner was building
one at that moment.

`test.yml` is the one worth having: fourteen mechanical checks, typecheck, the
full suite including the database tests, the migration chain from an empty
database, and a check that the server actually boots and shuts down cleanly.

`build-image.yml` publishes container images. It is an optimisation, not a
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

## What it is

Forgejo Actions runs jobs through a separate binary (`forgejo-runner`, formerly
`act_runner`) that polls Forgejo over HTTP and executes each job in a container.
It is stateless apart from its registration, so one runner or five, on the
Forgejo host or elsewhere, is a free choice.

A queued job with no runner is the normal symptom of never having registered
one: Forgejo shows the workflow as waiting, indefinitely and without an error.

## Labels are the part that catches people

`runs-on:` in a workflow matches a **label**, not a runner name. This project's
workflow uses `runs-on: ubuntu-latest`, because that is the label the existing
runner on this instance declares. If you point the project at a runner with
different labels, change `runs-on` to match — a healthy, connected runner whose
labels do not include the one a workflow asks for sits idle while the job queues
forever, which is the most misleading possible symptom.

Label syntax is `name:docker://image`, where the image is what a job runs inside
by default. A workflow can override it with `container.image`, which
`build-image.yml` does.

## Security note, read before mounting the socket

The runner needs the Docker socket to build images. That is root-equivalent
access to the Docker daemon on that host. For a private instance building your
own code it is a reasonable trade. It stops being reasonable the moment the
instance accepts pull requests from strangers, because a workflow in a fork
would run with that access — at that point the runner belongs on a dedicated
machine with nothing else on it.

## Setup

Get a registration token: **Site Administration → Actions → Runners → Create new
Runner**, or the same path under a user or organisation for a scoped runner. A
repository-level runner is usually too restrictive.

Tokens are single-use. If registration fails, generate a new one rather than
retrying with the same.

```yaml
# docker-compose.runner.yml — deploy as its own stack
name: forgejo-runner

services:
  runner:
    image: code.forgejo.org/forgejo/runner:6
    restart: unless-stopped
    environment:
      # Must be reachable from inside this container. If Forgejo runs in Docker
      # on the same host, the container name over a shared network is more
      # reliable than the public URL, which may hairpin badly through the proxy.
      FORGEJO_INSTANCE_URL: https://github.com/markusthiel
      FORGEJO_RUNNER_REGISTRATION_TOKEN: ${RUNNER_TOKEN:?set RUNNER_TOKEN}
      FORGEJO_RUNNER_NAME: thiel-docker-01
      # `ubuntu-latest` is the label this project's workflow requires. The
      # image is only the default job container; build-image.yml pins its own.
      FORGEJO_RUNNER_LABELS: ubuntu-latest:docker://node:22-bookworm
    volumes:
      # Persisted, or the container registers as a new runner on every restart
      # and the runner list fills with dead entries.
      - runner_data:/data
      # Root-equivalent access to the daemon. See the security note above.
      - /var/run/docker.sock:/var/run/docker.sock

volumes:
  runner_data:
```

```sh
RUNNER_TOKEN=<token> docker compose -f docker-compose.runner.yml up -d
docker compose -f docker-compose.runner.yml logs -f
```

The runner should appear under Actions → Runners within a few seconds, showing
`docker` among its labels. Once it does, re-run the queued workflow.

Environment variable names differ slightly between runner images. If the
container starts and does nothing, check its logs for a complaint about a
missing variable before assuming a Forgejo-side problem — most images also
accept a mounted `config.yml`, which is the more portable route if the variables
do not take.

## The Docker daemon inside a job

**Required by `build-image.yml`.** It builds with buildx and then runs the image
it built, so the job needs a reachable daemon. The runner on this instance has
one, and the image workflow has been publishing successfully — but if it ever
reports "no daemon reachable", there are two causes and they need different
fixes:

**The runner container has no socket at all.** If the runner itself was started
without `-v /var/run/docker.sock:/var/run/docker.sock`, no amount of runner
configuration will help — it cannot pass on access it does not have. Add the
mount to the runner's own compose file and restart it. Check with:

```sh
docker compose -f docker-compose.runner.yml exec runner ls -l /var/run/docker.sock
```

**The runner has the socket but does not pass it into job containers.** Forgejo
Runner's `container.docker_host` defaults to `"-"`, which mounts the host daemon
socket into each job container automatically. If it has been set to an empty
value, either restore the default or whitelist the socket so a workflow may
mount it:

```yaml
container:
  valid_volumes:
    - /var/run/docker.sock
```

The workflow deliberately does **not** mount the socket itself with `options:`,
and sets no `container:` at all. Runner rejects volume mounts that are not
whitelisted, so a workflow requiring one would depend on configuration the
project cannot see — and overriding the job image is what removed the daemon in
every earlier attempt here, since the runner's default job image is the one that
has it.

## Verifying it works

Push any commit to `main`. The workflow should build and publish
`ghcr.io/markusthiel/sone:main`. Then:

```sh
docker pull ghcr.io/markusthiel/sone:main
```

**Check the package is publicly readable**, under Packages → the image →
Settings. Forgejo inherits package visibility from the repository, so a package
first pushed while the repository was private stays private afterwards — and
then `docker compose up` fails for everyone except you, with an
authentication error rather than anything informative.

Publishing works and has since 0.5.0. Anonymous pull works too, which is the
part that is easy to get wrong — checked without credentials:

```sh
tok=$(curl -s "https://github.com/markusthiel/v2/token?service=container_registry&scope=repository:thiel/sone:pull" \
        | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -H "Authorization: Bearer $tok" https://github.com/markusthiel/v2/thiel/sone/tags/list
```

## Deploying from an image

Use `docker-compose.yml` rather than `docker-compose.build.yml` and set
`SONE_IMAGE` to a released tag — `ghcr.io/markusthiel/sone:0.11.0`. That
trades a multi-minute build on the deployment host for a pull. `:main` is the
development branch and is not for production; `:latest` never points at a
pre-release.

## If it stays queued

In rough order of likelihood:

1. No runner registered, or it registered against a different scope than the
   repository. A user-level runner does not serve an organisation's
   repositories.
2. The runner's labels do not include the one the workflow asks for
   (`ubuntu-latest`). This is the most common cause of a connected, healthy,
   idle runner.
3. Actions are disabled for the repository. Settings → Actions, per repository —
   it is not on by default everywhere.
4. The runner cannot reach the instance URL from inside its container.


## The image job gets slower over time

It should take about a minute. If it is taking several, the runner is probably
full rather than the build being slow.

The image job loads a complete image into the runner's Docker daemon on every
run, so it can be inspected before it is published. Those images are removed
again in a cleanup step that runs even when the job fails — but a runner that
predates that step, or one shared with other repositories, can still be carrying
a lot:

```sh
docker system df          # what is actually taking the space
docker image prune -a -f  # images nothing references
docker buildx prune -f    # build cache
```

The job now prints `df -h /` and `docker system df` before building and after
cleaning up, so the log answers this without anyone logging in.
