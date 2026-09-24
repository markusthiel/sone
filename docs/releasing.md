# Releasing

See [ADR-0013](adr/0013-versioning-and-releases.md) for what the version number
means and why.

## The short version

```sh
pnpm -r test              # or wait for CI
# add the CHANGELOG entry for the version
node scripts/release.mjs 0.1.0
git push origin main v0.1.0
```

`release.mjs` refuses to proceed when a step was skipped: a dirty working tree,
a tag that already exists, a version that does not move forwards, or — the one
that actually gets missed — a missing changelog entry. Release notes are the
only part of a release that cannot be added afterwards, because a released tag
is never moved.

Then point the deployment at `refs/tags/v0.1.0`. **No container image is
needed for that**; see docs/deployment.md.

The `build-image` workflow is manual-only while no runner has Docker daemon
access. If it is ever re-enabled on tags and fails, the tag is still fine — a
tag points at a commit, and whether an image was built afterwards does not
change what that commit contains.

## Once, at 0.1.0

Change the `image:` default in `docker-compose.yml` from `:main` to `:latest`.
It points at `:main` until then because `:latest` is only published for a
non-pre-release tag, and a default naming a tag that does not exist gives a 404
on pull.

## Full checklist

1. **Verify the migration chain from empty.** Not from your development
   database — from nothing. An upgrade path that only works on a database that
   grew alongside the code is not an upgrade path.

   ```sh
   docker compose -f docker-compose.test.yml down -v
   docker compose -f docker-compose.test.yml up -d
   pnpm --filter @sone/server migrate
   ```

2. **Verify the upgrade path from the previous release.** Start the previous
   version, create a page, upgrade in place, confirm the page is intact. This
   is the test that catches a migration which is valid SQL but wrong.

3. `pnpm -r typecheck && pnpm -r test` and the database suite.

4. **Check the contract versions.** If `SCHEMA_VERSION` or
   `PROTOCOL_VERSION` changed, the release notes must say so and, pre-1.0, the
   changelog entry must warn about it.

5. Write the CHANGELOG entry. Operator action first.

   **Move the entries into it.** Renaming "Unreleased" to the version, or
   inserting a version heading *above* the entries, both leave the notes under
   a heading nobody reads for a version they have installed. 0.4.0 was tagged
   that way: its section held the summary and the sentence "the features below
   need no configuration", and below it there was nothing. `pnpm release`
   refuses both shapes now — a section with fewer than two entries, and
   anything left under "Unreleased" — but the fix is to write it the right way
   round, not to be caught.

6. Set the version in the root `package.json`, dropping `-dev`.

7. Tag, annotated:

   ```sh
   git tag -a v0.1.0 -m "SONE 0.1.0"
   git push origin v0.1.0
   ```

8. *Optional.* Build and push images with `SONE_VERSION` and `SONE_COMMIT`
   baked in. A tag alone is enough to deploy reproducibly; an image only saves
   the deployment host a build.

   Images live in the project's own Forgejo container registry, which is the
   same host as the source. One less account for anyone mirroring the project,
   and no dependency on a third party staying friendly.

   ```sh
   REGISTRY=forgejo.thiel.tools/thiel/sone
   docker login forgejo.thiel.tools

   docker build -f docker/Dockerfile \
     --build-arg SONE_VERSION=0.1.0 \
     --build-arg SONE_COMMIT="$(git rev-parse HEAD)" \
     -t "$REGISTRY:0.1.0" \
     -t "$REGISTRY:0.1" \
     -t "$REGISTRY:latest" .

   docker push "$REGISTRY:0.1.0"
   docker push "$REGISTRY:0.1"
   docker push "$REGISTRY:latest"
   ```

   The registry must be publicly readable, or `docker compose up` fails for
   everyone but the maintainer. Check under Packages → the image → Settings
   after the first push; Forgejo inherits visibility from the repository, so a
   package pushed while the repo was private stays private even after the repo
   is made public.

9. Bump the root `package.json` to the next `-dev` version on `main`.

## Rules

- **A released tag is never moved or deleted.** If a release is broken, the
  next patch fixes it. Moving a tag breaks everyone who already pulled it, and
  silently.
- `:latest` never points at a pre-release.
- `:main` is the development branch and is not for production. Say so in the
  release notes if anyone asks for it.
- Migrations are forward-only. A rollback is a backup restore, and the release
  notes for a major version name the backup step explicitly.
