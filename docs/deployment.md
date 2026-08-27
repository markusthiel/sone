# Deployment

One application container plus Postgres. Nothing else is required — no Redis,
no search cluster, no separate nginx (ADR-0005).

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
- Reference: `refs/heads/main`
- Compose path: `docker-compose.build.yml`
- Environment variables: `SONE_SECRET_KEY`, `POSTGRES_PASSWORD`,
  `SONE_PUBLIC_URL`

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

It needs a registered Forgejo Actions runner carrying a `docker` label. Without
one the workflow simply queues, indefinitely and without an error — see
[actions-runner.md](actions-runner.md). Nothing about deploying or testing SONE
depends on it: build from source until it is worth setting up.

## Things that will bite you

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
