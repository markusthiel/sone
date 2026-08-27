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
loads and then never syncs.

The app now says so: the status line reads "Cannot reach the sync server" with
the detail on hover, rather than an indefinite "Syncing…". Pages show
"Opening…" because no document can be opened without a connection, and edits are
kept locally until one works — nothing is lost, but nothing reaches anyone else
either.

For nginx:

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

## Files

Uploads land under `SONE_STORAGE_PATH` (`/var/lib/sone/files` in the image), and
`SONE_MAX_UPLOAD_MB` caps a single file at 100 MB by default.

Storage is content-addressed: the key is the SHA-256 of the contents, so
identical files are stored once no matter how many pages reference them. That
also means a file is never rewritten in place, so the volume only grows —
deleting a page removes its rows, and reclaiming the bytes is not implemented
yet.

**Back this volume up with the database, not separately.** A database restored
without its files leaves image blocks that report "recorded but missing from
storage"; files restored without the database are unreferenced bytes. The backup
command captures files before the database, so a restore never references a file
that was not captured.

## Backups and the Postgres client version

`pg_dump` refuses to dump a server newer than itself. The image pins
`postgresql17-client` to match the Postgres in `docker-compose.yml`, so the
bundled setup is consistent.

If you point SONE at an **external** Postgres that is newer than 17, backups
will fail with a version-mismatch error naming both versions. The fix is a newer
client in the image, not a change to the database. The backup command reports
this explicitly rather than passing on `pg_dump`'s own wording, which does not
say what to do about it.

## The server restarts in a loop with a migration error

```
[migrate] applying 0007_folders.sql
[migrate] FAILED 0007_folders
[migrate] failed: column "kind" of relation "pages" already exists
```

A migration applied its changes but was never recorded, so every start retries
it and fails on something that now exists. The server never finishes booting,
nothing answers, and the only visible symptom is a blank page.

Fixed at the source: the affected migration is idempotent, and the runner now
records a version itself when the file did not — so a file forgetting to record
itself can no longer stop an instance booting. `scripts/check-migrations.mjs`
rejects such a file before it reaches a deployment, and CI runs it.

**To recover an instance already looping:** deploy an image containing the fix
and restart. Nothing needs to be done by hand — the affected migration applies
cleanly against a database that already has its changes.

If you are ever stuck on a version without the fix, recording the migration by
hand is safe when its changes are demonstrably present:

```sql
INSERT INTO schema_migrations (version) VALUES ('0007_folders')
  ON CONFLICT (version) DO NOTHING;
```

Check first that the change really did apply, or the schema will be missing
something the code assumes:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'pages' AND column_name = 'kind';
```

## The server refuses to start on an apparent downgrade

If **`/api/version` itself returns nothing**, no application code is involved:
the server is not running. The most likely reason is the version fence.

Migrations are forward-only, so SONE refuses to start against a database last
used by a newer version. That guard is right, but it compares version *strings*,
and a string can be misleading. One case in particular:

```
this database was last used by SONE 0.1.0-rc.1, but this is 0.1.0-dev.89ecc20.
Downgrading is not supported.
```

Pre-release identifiers compare alphabetically, so `dev` sorts before `rc`. An
instance first started from the `v0.1.0-rc.1` tag and then pointed at `:main`
therefore looked like a downgrade — and the container exits, so nothing answers
at all and the only visible symptom is a blank page.

Fixed at the source: development builds are now versioned from `git describe`,
e.g. `0.1.0-rc.1-7-g8ff137f`, which sorts after the tag it follows. An image
built after that fix starts normally.

To recover an instance already in this state, either pull an image newer than
the fix, or start once with:

```
SONE_ALLOW_DOWNGRADE=true
```

Remove it afterwards. It logs a warning on every start and it is not a setting.
The document-format check is deliberately **not** bypassable by it: that one is
about whether the code can read the data rather than about a label.

Always check the container logs when nothing answers. The startup sequence
reports the version, the migration state and the fence result in plain text, and
a refusal to start says exactly why.

## First question when something is wrong: which version is serving?

```
https://<your-instance>/api/version
```

No authentication, no tooling, works in a browser tab. It reports the version
and commit of the code answering requests. Everything else is guesswork until
this is known.

A **locally built** image is the trap worth naming. If the stack was set up with
`SONE_IMAGE=sone-local:latest` after building on the host, then:

- the running code is whatever was checked out at build time, not the newest
  commit;
- Portainer correctly reports no newer image, because a local tag has no
  registry behind it to pull from;
- redeploying changes nothing, and neither does a private window.

Every one of those looks like a caching problem and none of them is. Switch to
`SONE_IMAGE=forgejo.thiel.tools/thiel/sone:main` to follow development, or
rebuild on the host from a newer checkout.

## Redeploying does not re-pull by default

`:main` is a moving tag. Docker does not re-fetch a tag it already has locally,
and Portainer's redeploy does not pull unless told to — so a redeploy after a
new image was published runs **the old image**, silently.

In Portainer: **Update the stack** → tick **Re-pull image and redeploy**. Or on
the host:

```sh
docker compose pull && docker compose up -d
```

This is the most likely explanation for a symptom that survives a redeploy. To
check what is actually running, compare Settings → About with the published
image:

```sh
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' <container> \
  | grep SONE_
```

A moving tag is convenient for following development and treacherous for
diagnosing anything. Once 0.1.0 exists, prefer a version tag: it cannot
silently mean something different than it did yesterday.

## Which version is running

The About section of Settings shows two versions, and the difference matters:

- **Server** — from `/api/version`, the code handling requests.
- **This browser** — baked into the client bundle at build time.

When they disagree, the browser is holding a cached bundle from an earlier
deployment and says so with a reload button. Without that distinction, asking
"which version am I running?" over HTTP returns the server's answer about code
that is not the code executing — which is how bug reports arrive for versions
that no longer contain the bug.

The running version also appears at the bottom of the sidebar, so the answer is
one glance rather than a navigation.

`/api/version` needs no authentication. That is deliberate: the version is not a
secret, and being able to read it without logging in is what makes it useful
when logging in is what is broken.

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
