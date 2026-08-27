# Deployment

One application container plus Postgres. Nothing else is required — no Redis,
no search cluster, no separate nginx (ADR-0005).

## When Portainer cannot build

A repository stack may fail with:

```
compose build operation failed: listing workers for Build: failed to list
workers: Unavailable: connection error: desc = "error reading server preface:
http2: failed reading the frame payload: http2: frame too large, note that the
frame header looked like an HTTP/1.1 header"
```

BuildKit talks gRPC over a hijacked HTTP connection, and something between
Portainer and the Docker daemon is answering HTTP/1.1 — usually the Portainer
Agent, or a reverse proxy in front of the Docker endpoint. BuildKit builds do not
survive that path.

Do not work around it inside Portainer. Build on the host once and deploy an
image:

```sh
# On the Docker host, in a checkout of the tag you want:
git clone https://forgejo.thiel.tools/thiel/sone
cd sone
git checkout v0.1.0-rc.1

docker build -f docker/Dockerfile \
  --build-arg SONE_VERSION="$(git describe --tags --always)" \
  --build-arg SONE_COMMIT="$(git rev-parse HEAD)" \
  -t sone-local:latest .
```

Then in Portainer use **Web editor** — which works fine for a stack that does
not build — paste `docker-compose.yml`, and set:

```
SONE_IMAGE = sone-local:latest
```

plus the usual variables. That stack pulls nothing and builds nothing; it just
runs the image already on the host.

Rebuilding for a new version means repeating the `docker build` and redeploying
the stack.

## No image published yet

Until the first release there is nothing to pull, and
`docker compose up` fails with:

```
failed to resolve reference "forgejo.thiel.tools/thiel/sone:latest": not found
```

Build from source instead:

```sh
cp .env.example .env
# set SONE_SECRET_KEY and POSTGRES_PASSWORD
docker compose -f docker-compose.build.yml up -d --build
```

`docker-compose.build.yml` is self-contained rather than an override file,
because Portainer's stack editor takes a single compose path.

### In Portainer

Stacks → Add stack → **Repository**:

- Repository URL: `https://forgejo.thiel.tools/thiel/sone`
- Reference: `refs/tags/v0.1.0-rc.1` for a fixed release, or `refs/heads/main`
  to follow development
- Compose path: `docker-compose.build.yml`
- Environment variables: `SONE_SECRET_KEY`, `POSTGRES_PASSWORD`,
  `SONE_PUBLIC_URL`

This requires Portainer to be able to build. If it cannot — see the section
above — build on the host instead.

**A web-editor stack cannot use `docker-compose.build.yml`.** Pasting compose
text gives Docker no build context, so `build: context: .` refers to a directory
that does not exist. Either use a repository stack, or build on the host and use
`docker-compose.yml` with `SONE_IMAGE`.

**A tag reference is what makes a deployment reproducible, and it needs no
container image.** Portainer clones the repository at that reference and builds
it, so the deployed code is exactly the tagged commit. Following `main` instead
means a redeploy picks up whatever has landed since, which is right while
testing and wrong once anyone depends on the instance.

Registry images are a convenience on top of this — they trade a multi-minute
build on the deployment host for a pull. They are not required to deploy a
specific version.

Enable automatic updates or use "Pull and redeploy" to pick up new commits.
Building on the deployment host takes a few minutes the first time; afterwards
Docker's layer cache makes a source-only change much quicker.

Note that a Git-repository stack builds from the repository, not from your local
checkout — so a commit has to be pushed before it can be deployed.

## Once an image is published

```sh
cp .env.example .env
docker compose up -d
```

`.forgejo/workflows/build-image.yml` builds and pushes on every push to `main`
(tagged `main`) and on every version tag (`X.Y.Z`, `X.Y`, and `latest` for
non-pre-releases).

It builds with buildah and needs no Docker daemon, so any runner will do.

Before publishing, it inspects the built image and refuses to push one that runs
as root, exposes no port, carries no version, or has lost its healthcheck —
each of which has been wrong at some point.

## Things that will bite you

**Do not change `PORT`.** The compose file maps `${SONE_PORT:-3000}` on the host
to 3000 in the container, so a different host port is `SONE_PORT` alone. `PORT`
is the container's own side, and the healthcheck baked into the image asks 3000 —
change one without the other and the container is judged unhealthy and restarted
in a loop.

**`SONE_PUBLIC_URL` must be the address users actually reach.** Share links are
generated against it, and it decides whether the session cookie is marked
`Secure`. Set it to `https://…` and the cookie only travels over TLS — correct
in production, and a silent login failure if the instance is actually served
over plain http.

**The reverse proxy must forward WebSocket upgrades** for `/sync`, or the app
loads and then never syncs, which looks like a broken editor rather than a proxy
problem. For nginx:

```nginx
location /sync {
    proxy_pass http://sone:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # The client pings every 30s and the server drops idle connections at 90s,
    # so anything above 120s is fine. The nginx default of 60s is not: it cuts
    # a healthy connection and the client reconnects in a loop.
    proxy_read_timeout 300s;
}
```

Traefik and Caddy handle upgrades automatically.

**The database locale is set once, at initialisation.** `POSTGRES_INITDB_ARGS:
--locale=C` in the compose file only applies to a fresh data volume. Pointing
SONE at an existing Postgres with a locale-aware collation makes it refuse to
start, on purpose: fractional index ordering is byte-wise, and a locale-aware
collation silently reorders blocks (ADR-0011). Create a dedicated database with
`--locale=C` rather than reusing one.

**Backups belong on a different disk.** The compose file puts them in a named
volume, which is convenient and on the same disk as the data they protect. Mount
a host path or a network share instead:

```yaml
volumes:
  - /mnt/backups/sone:/var/lib/sone/backups
```

## Backups and the Postgres client version

`pg_dump` refuses to dump a server newer than itself. The image pins
`postgresql17-client` to match the Postgres in `docker-compose.yml`, so the
bundled setup is consistent.

If you point SONE at an **external** Postgres that is newer than 17, backups
will fail with a version-mismatch error naming both versions. The fix is a newer
client in the image, not a change to the database. The backup command reports
this explicitly rather than passing on `pg_dump`'s own wording, which does not
say what to do about it.

## Health and readiness

- `GET /api/health` — liveness. No database call. This is what the container
  healthcheck uses, so a brief database blip does not get the container
  restarted.
- `GET /api/ready` — readiness. Checks database, migrations, collation and
  document rooms. This is what a load balancer should use: it removes an
  instance from rotation rather than killing it.
- `GET /api/version` — application version plus the document schema and sync
  protocol versions, which are what actually determine compatibility
  (ADR-0013).

## First run

Open the instance and the setup screen creates the first workspace and its
owner. It refuses once any workspace exists, so the endpoint cannot be used to
add a second owner later.

`SONE_SIGNUP_MODE` defaults to `invite`: new accounts need an invitation. Set it
to `open` only if you want anyone reaching the URL to be able to register —
there is no seat limit to slow that down (ADR-0007), which makes a sane default
more important rather than less.

## Building the image yourself

```sh
docker build -f docker/Dockerfile \
  --build-arg SONE_VERSION="$(git describe --tags --always)" \
  --build-arg SONE_COMMIT="$(git rev-parse HEAD)" \
  -t forgejo.thiel.tools/thiel/sone:local .
```

The build compiles every package including the web client, and the runtime image
serves both the API and the client from one process.

## Upgrading

```sh
docker compose pull && docker compose up -d
```

Database migrations run on start. Document format migrations run lazily as pages
are opened. The server refuses to start on a downgrade rather than corrupting
data. See [ADR-0014](adr/0014-automatic-upgrades.md) for what is automatic and
what is not.

Take a backup first — it is one command and the only way back:

```sh
docker compose exec app node packages/server/scripts/backup.mjs
```
