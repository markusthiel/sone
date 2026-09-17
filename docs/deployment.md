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

**The reverse proxy needs its upload limit raised**, or images fail.

nginx allows one megabyte by default, which rejects essentially every photo. It
answers with an HTML error page that never reaches SONE, so the failure looks
like a bug in the application rather than a setting in the proxy — the block on
the page now says so explicitly, but the fix is here:

```nginx
server {
    # At least as large as SONE_MAX_UPLOAD_MB, which defaults to 100 MB.
    # A value smaller than SONE's own limit means SONE accepts a size the proxy
    # will refuse, which is the confusing way round.
    client_max_body_size 100M;

    location / {
        proxy_pass http://sone:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Caddy has no limit by default. Traefik has none either, but if
`maxRequestBodyBytes` is set on a middleware it applies here too.

Keep the two limits in step. If uploads should be smaller, lower
`SONE_MAX_UPLOAD_MB` as well, so the refusal comes from SONE with a message
somebody can read instead of from the proxy with a page nobody sees.

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

## Deleted entries keep their storage

Deleting archives. The row, the document history and any attachments stay until
somebody destroys the entry from the trash, and **nothing is removed on a
schedule** — an instance that quietly empties its own trash is one that loses
somebody's work while they are on holiday.

That means a workspace where a lot has been deleted still uses the space. If
disk is the problem, the trash is the first place to look.

Destroying is genuinely irreversible: the CRDT log is where the content lives,
so once it is gone the page cannot be rebuilt from anything except a database
backup.

## When a page is missing from search or the tree

The page is fine — its document syncs and opens. What failed is the projection,
the Postgres copy that search and the sidebar read.

Settings → Maintenance shows these under "Failed projections". The maintenance
pass retries each one with a growing delay and gives up after six attempts, on
the reasoning that a document which cannot be read is a bug rather than a
hiccup. After that it waits for a person: fix the cause, then press Retry on
that page, which clears the counter so automatic retries resume too.

## Configuration: environment or interface

Two places, and the split matters when something appears not to take effect.

Anything needed before the database opens stays in the environment:
`SONE_DATABASE_URL`, `SONE_SECRET_KEY`, `SONE_PORT`, `SONE_PUBLIC_URL`,
`SONE_STORAGE_PATH`. A server that cannot start cannot be configured from a
screen it never shows.

A few values can be changed in Settings → Instance and are stored in the
database, where they **override the environment**: who may sign up, the instance
name, whether members may create workspaces, the default locale. The screen says
which values are overridden, because "I set this in the compose file and it is
being ignored" is otherwise an afternoon of confusion.

To return one to the environment value, clear it in the interface rather than
editing the compose file.

## Recovering administrator access

If the last administrator account is lost, promote another directly:

```sql
UPDATE users SET is_instance_admin = true, deactivated_at = NULL
 WHERE email = 'you@example.org';
```

The application refuses to demote or deactivate the last administrator, so this
should only be needed after a database was restored or an account was removed
outside the application.

## What is in the database but not in the documents

Almost everything is rebuildable from the CRDT log (ADR-0002), but some data is
not derived from documents at all and has to be backed up rather than
reconstructed:

- accounts, sessions and invitations
- workspace membership and page permissions
- share links
- **favourites** — a person's shortcuts, which belong to them rather than to the
  page they point at
- instance settings and which accounts administer the instance

Losing these does not corrupt anything, but it does mean people have to log in
again and rebuild their shortcuts. The backup command captures them with the
rest of the database.

## Settings: environment or database

Configuration comes from two places, and which one applies matters when
something appears to be ignored.

The environment holds anything needed before the database is reachable: the
database URL, the secret key, the port, the storage path. A server that cannot
start cannot be configured from a screen it never shows.

A few values can be changed by an instance administrator in Settings →
Instance, and those are stored in the database and **override the
environment**: `SONE_SIGNUP_MODE`, the instance name, and whether members may
create workspaces. If an environment variable seems to have no effect, check
that screen — it says which values are overridden.

## Two secrets that cannot live in the database

`SONE_SMTP_PASSWORD` (ADR-0058) and `SONE_OIDC_CLIENT_SECRET` (ADR-0024) are
read from the environment and nowhere else, and the administration screens
deliberately have no field for either. A secret in a table is a secret in every
backup, in every `pg_dump` somebody mails themselves, and in every copy of a
staging database.

Everything *else* about a mail server — host, port, encryption, user, sender —
can be set in Settings → Instance, which is where an operator will look. Only
the password has to be in `.env`.

For a Microsoft 365 mailbox the host is `smtp.office365.com`, port 587,
STARTTLS, user and sender both the mailbox address, and the password is an app
password if the account has a second factor. Exchange Online accepts a password
only as `AUTH LOGIN`, which SONE speaks; a tenant that has switched SMTP to
OAuth only will refuse any password, and the test mail then says so and names
what the relay offers instead.

**And `.env` alone is not enough.** Compose does not forward the host's
environment: a variable has to be named in the service's `environment:` block to
reach the container. Both secrets are named there now, along with the workspace
retention — fourteen variables were missing, so an operator who
filled in an SMTP password got a server that never saw it and mail that failed to
authenticate with no visible cause. `node scripts/check-env-reaches-container.mjs`
now fails if a variable the server reads is not reachable, and CI runs it.

If you are running SONE some other way — a hand-written unit file, a Kubernetes
manifest — that check cannot see your deployment. `packages/server/src/config.ts`
is the list, and `.env.example` documents each one.

## The first administrator

Whoever created the first workspace administers the instance. On an existing
deployment migration 0010 promotes that account automatically.

The last administrator cannot be demoted or deactivated, so an instance cannot
lock itself out. Recovering from a genuinely lost administrator means a database
edit:

```sql
UPDATE users SET is_instance_admin = true WHERE email = 'you@example.org';
```

## Uploads fail with "could not write the file to disk"

Since the container fixes this itself, this should no longer happen. It starts as
root, makes the storage and backup directories writable by uid 10001, and then
runs the server as that user — no root process survives the handover.

If the message still appears, the container could not take ownership, and it
says so in its log at startup. The two cases it cannot fix:

- **A read-only mount.** The directory has to be writable by something.
- **A filesystem that does not carry ownership**, such as some network shares.
  Mount it with `uid=10001,gid=10001` in its own options instead.

You can also keep root out of the container entirely by setting `user:` in
compose. The entrypoint notices it is not root and leaves ownership alone — in
that case the directory must already be writable by whichever user you chose:

```bash
# For a bind mount, on the host, using the host path from your compose file:
chown -R 10001:10001 /srv/sone/files /srv/sone/backups
```

A bind mount is why this mattered. Docker copies an image's ownership into a
fresh named volume and **never** into a bind mount, so a host directory arrives
owned by whoever made it — usually root — and a server running as uid 10001
cannot write to it.

## Share links and SONE_SECRET_KEY

Share tokens are stored encrypted under a key derived from `SONE_SECRET_KEY`, so
a link can be copied again by whoever administers the page. Two consequences
worth knowing:

- **Changing `SONE_SECRET_KEY` makes existing links uncopyable.** They keep
  working — the lookup is by hash — but the dialog can no longer show them, and
  offers to replace them instead.
- **A database dump alone does not contain usable links.** The key is in the
  environment. This is the point: read-only SQL access, a replica or a backup on
  a shared disk must not become write access through an editable link.

Links created before migration 0011 have no stored token and cannot be copied.

## Deleted workspaces

A deleted workspace is marked, not removed: it disappears for its members and
can be restored. `SONE_WORKSPACE_RETENTION_DAYS` decides how long that lasts
before the maintenance job removes it for good — a month by default.

Long enough for somebody to notice a mistake, short enough that "deleted" means
what people take it to mean when they ask whether their notes are still here.

That sentence was not true until 0.11.x. The purge removed the page entries and
left every page's content in the database — invisible, unreachable and
permanent, because the CRDT tables carry no foreign key to `pages` (ADR-0080).
It removes both now, and the attachments a purge leaves on disk can be reclaimed
with `sweep-orphan-files.mjs` (ADR-0109) — deliberately not from the purge
itself, which is not the moment to decide to delete bytes.

Content left behind by a purge that ran on an *earlier* version can now be
removed, and is not removed for you (ADR-0106). The maintenance job counts it —
"N document(s) belong to no page" in the log and the `orphaned_documents`
view — and a script does the removing:

```sh
# reports, and removes nothing
docker compose exec app node packages/server/scripts/sweep-orphan-documents.mjs
# once the list looks right
docker compose exec app node packages/server/scripts/sweep-orphan-documents.mjs --apply
```

It reports by default because the query behind it is the one thing in this area
worth being careful about: a document belonging to no page is *usually* content
from a purge, and occasionally a document that arrived a moment before the page
row it belongs to. Only writes older than a week are considered
(`--older-than-hours`), and `--limit` keeps a first run small enough to read.

### Numbers the environment sets

`SONE_VERSION_RETENTION_DAYS` (how long page history is kept, 90 by default) is
refused below one day. It used to be accepted: `0` meant "delete every version
of every page on the next maintenance pass".

Five more settings are read the same way, and were not checked at all until
ADR-0111. All six now behave alike: a value that is not usable is **refused**,
the server writes one line at startup naming the variable and what was in it,
and the built-in default is used. Nothing else about the instance changes, and
a correctly configured deployment sees no difference.

| | default | refused |
|---|---|---|
| `SONE_VERSION_RETENTION_DAYS` | 90 | below 1, or not a whole number |
| `SONE_VERSION_QUIET_MINUTES` | 10 | below 1 — every changed page would be versioned every five minutes |
| `SONE_JOB_RESULT_HOURS` | 24 | below 1 — an export would expire before its link is shown |
| `SONE_EMAIL_DELAY_MINUTES` | 5 | below 0; `0` is allowed and means "send at once" |
| `SONE_DB_POOL_MAX` | 10 | below 1 |
| `SONE_PASSWORD_COST` | 16 | outside 10–20 |

None of the six reached a Compose deployment at all until ADR-0112 — the
service's `environment:` block did not name them, and Compose does not forward
the host's environment. If you had one of these in `.env` and wondered why
nothing changed, that is why; it works now, so check the values you set before
upgrading.

The one worth knowing about is `SONE_JOB_RESULT_HOURS`. Set to something that is
not a number, it used to produce an invalid timestamp in the statement that
records a job as **finished** — so exports and imports that had run perfectly
were written down as failed and retried until they ran out of attempts, and
nothing in the message pointed at a setting about retention.

## Single sign-on

Set `SONE_OIDC_CLIENT_SECRET` to the client secret from your provider; everything
else is configured under Settings → Single sign-on. Without the secret, single
sign-on stays off whatever the administration area says — a secret in the
database is a secret in every backup.

Password sign-in remains available alongside it, and the instance administrator
can always sign in with a password.

See [docs/single-sign-on.md](single-sign-on.md) for the full walkthrough,
including a worked Keycloak example and what each error code means.

## Local copies in the browser

A signed-in member's browser keeps a copy of each document it opens, so an edit
made while the server is unreachable survives a reload — not only the connection
dropping, which the editor already handled in memory.

There is no merging to worry about. Both the local copy and the server's updates
are applied to the same CRDT, and applying them in any order reaches the same
document; there is nothing to compare and no conflict for anybody to resolve.

Two things worth knowing:

- **A share-link guest gets no local copy.** They are often on a borrowed
  machine, and the link grants access to read a page rather than to keep it.
- **Signing out deletes them**, and copies untouched for 30 days are deleted at
  startup. The server holds the document, so losing a local copy costs a reload
  and never any writing.

## Files

Uploads land under `SONE_STORAGE_PATH` (`/var/lib/sone/files` in the image), and
`SONE_MAX_UPLOAD_MB` caps a single file at 100 MB by default.

Storage is content-addressed: the key is the SHA-256 of the contents, so
identical files are stored once no matter how many pages reference them. That
also means a file is never rewritten in place: deleting a page removes its rows
and leaves the bytes, and so does replacing a profile picture — deleting on
replace could take the file somebody else's identical picture is using.

**Reclaiming those bytes is a script you run** (ADR-0109). The maintenance job
counts them — "N stored file(s) belong to no row" in the log — and:

```sh
# reports, and removes nothing
docker compose exec app node packages/server/scripts/sweep-orphan-files.mjs
# once the list looks right
docker compose exec app node packages/server/scripts/sweep-orphan-files.mjs --apply
```

It knows about all three places a storage key lives — attachments, profile
pictures (`users.avatar_key`, which is *not* in the files table) and a workspace
export waiting to be downloaded — and it considers only files older than a week
(`--older-than-hours`), which is what keeps an upload in flight out of reach.

**Local is the only backend.** Object storage is not supported, and the server
refuses to start if it is configured (ADR-0107).

**Back this volume up with the database, not separately.** A database restored
without its files leaves image blocks that report "recorded but missing from
storage"; files restored without the database are unreferenced bytes. The backup
command captures files before the database, so a restore never references a file
that was not captured.

## Restoring a backup

**Stop SONE first.** A backup runs against a live instance on purpose; a restore
does not, and the reason is not caution: rooms in memory hold documents that
would no longer match the database being replaced underneath them, and the first
edit after that writes the old document back over the restored one.

```sh
docker compose stop app
docker compose run --rm app node packages/server/scripts/restore.mjs --archive /var/lib/sone/backups/sone-<stamp>
docker compose start app
```

The restore verifies both checksums before it touches anything, and applies the
dump in **one transaction**: if it fails, the database is as it was.

Three things the restore does not do, said here because each has surprised
somebody:

- **It does not run migrations.** Start the SONE version named in the output, or
  a newer one, and migrations run on start as usual.
- **`--force` does not empty the database.** It skips the "target is not empty"
  refusal, nothing more. The dump drops and recreates only what is in it, so
  restoring an *older* backup over a *newer* schema leaves the newer tables in
  place while `schema_migrations` is rewound — and the next start fails on a
  column that already exists. Use `--force` to restore over the same instance's
  own data; use a fresh database to go backwards.
- **It does not carry your secrets.** `SONE_SECRET_KEY`, `SONE_SMTP_PASSWORD`
  and `SONE_OIDC_CLIENT_SECRET` live in the environment and are deliberately not
  in the archive. Keep the key with the backup, somewhere the backup is not.

  Restoring with a *different* `SONE_SECRET_KEY` used to succeed and then
  quietly fail to read anything sealed with the old one — second factors, share
  links and mail reply tokens stopping one account at a time, with no error.
  **The restore now refuses it.** The manifest carries a fingerprint of the key
  the archive was sealed under (never the key itself), and a mismatch stops the
  restore before anything is touched, naming what would have broken.

  `--different-key` proceeds anyway, for the case where the old key is genuinely
  gone; it warns, and the loss is real. An archive written before this field has
  no fingerprint, so the restore says it could not check rather than passing
  quietly.

**There is no S3 backend, and there never was** (ADR-0107). This paragraph used
to say that an instance with `SONE_S3_*` set "has a database backup and a
bucket, and the bucket needs a backup of its own". There was no bucket: the
setting was accepted, its five companions were validated, and `main.ts` built a
local store anyway — so uploads went to the volume while the backup skipped that
volume *because of the same setting*. Anybody who followed that advice was
backing up an empty bucket.

The server now refuses to start with `SONE_STORAGE_BACKEND=s3` and says where
the files actually are. If you have an archive taken while it was set, it
contains no attachments: they are on the source's disk under
`SONE_STORAGE_PATH`, and the restore says so instead of sending you to a
bucket.

A directory whose name ends in `.incomplete` is a backup that was interrupted
before it finished. It cannot be restored, and the restore says so rather than
failing on a missing file.

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

The server prints a **setup key** at startup while no workspace exists yet:

```sh
docker compose logs sone
```

Open the instance, enter the key, and the setup screen creates the first
workspace and its owner. It refuses once any workspace exists, so the endpoint
cannot be used to add a second owner later.

The key exists because "no workspace yet" is true for a window somebody else can
be inside (ADR-0155): the proxy in front of a fresh container is already
answering on a public name, and whoever reached the URL first became the instance
administrator — with the operator's own attempt then answering *already set up*.
The key lives only in the process, expires on restart, and is spent with the
first account. Restart to get a new one.

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
