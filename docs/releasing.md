# Releasing

See [ADR-0013](adr/0013-versioning-and-releases.md) for what the version number
means and why.

## Checklist

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

6. Set the version in the root `package.json`, dropping `-dev`.

7. Tag, annotated:

   ```sh
   git tag -a v0.1.0 -m "SONE 0.1.0"
   git push origin v0.1.0
   ```

8. Build and push images with `SONE_VERSION` and `SONE_COMMIT` baked in.

   Images live in the project's own Forgejo container registry, which is the
   same host as the source. One less account for anyone mirroring the project,
   and no dependency on a third party staying friendly.

   ```sh
   REGISTRY=ghcr.io/markusthiel/sone
   docker login ghcr.io

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
