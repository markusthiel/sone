# Forgejo Actions runner

Only needed to publish container images automatically. **Deploying and testing
SONE does not require it** — `docker-compose.build.yml` builds from source on
the deployment host and needs no CI at all. Set this up when it is not blocking
anything.

## What it is

Forgejo Actions runs jobs through a separate binary (`forgejo-runner`, formerly
`act_runner`) that polls Forgejo over HTTP and executes each job in a container.
It is stateless apart from its registration, so one runner or five, on the
Forgejo host or elsewhere, is a free choice.

A queued job with no runner is the normal symptom of never having registered
one: Forgejo shows the workflow as waiting, indefinitely and without an error.

## Labels are the part that catches people

`runs-on:` in a workflow matches a **label**, not a runner name. This project's
workflow uses `runs-on: docker`, so the runner must declare a `docker` label or
the job queues forever even with a healthy runner connected.

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
      # `docker` is the label this project's workflow requires. The image is the
      # default job container; build-image.yml overrides it with docker:27-cli.
      FORGEJO_RUNNER_LABELS: docker:docker://node:22-bookworm
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

## Once images publish

Switch the deployment from `docker-compose.build.yml` to `docker-compose.yml`
and change the image tag to `:main` while there is no release yet. That trades a
multi-minute build on the deployment host for a pull.

## If it stays queued

In rough order of likelihood:

1. No runner registered, or it registered against a different scope than the
   repository. A user-level runner does not serve an organisation's
   repositories.
2. The runner has no `docker` label. This is the most common cause of a
   connected, healthy, idle runner.
3. Actions are disabled for the repository. Settings → Actions, per repository —
   it is not on by default everywhere.
4. The runner cannot reach the instance URL from inside its container.
