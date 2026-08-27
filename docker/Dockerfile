# SONE production image.
#
# Multi-stage: the build stage carries the toolchain, the runtime stage does
# not. Runs as a non-root user; the data paths are the only writable ones.
#
# One image serves both the API and the built web client, so a deployment is
# this container plus Postgres — no separate nginx to keep in sync.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Manifests first, so a source-only change reuses the dependency layer.
#
# Each workspace package must be listed here. A missing one fails
# `pnpm install --frozen-lockfile`, and a listed-but-absent one fails the COPY —
# which is how an earlier version of this file broke: it referenced a
# packages/editor that did not exist yet and omitted packages/client.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json     packages/core/
COPY packages/client/package.json   packages/client/
COPY packages/editor/package.json   packages/editor/
COPY packages/server/package.json   packages/server/
COPY packages/web/package.json      packages/web/
RUN pnpm install --frozen-lockfile

COPY . .
# Builds every package, including the web client into packages/web/dist.
RUN pnpm -r build

# KNOWN ISSUE: the image carries about 26 MB of build tooling it does not need.
#
# Neither `pnpm prune --prod` nor `pnpm install --prod --frozen-lockfile`
# removes the devDependencies of workspace packages — both were tried and
# verified by mounting the built image, where typescript, vite and tsx were
# still linked into packages/web/node_modules afterwards. pnpm prunes the root
# project only.
#
# The proper fix is `pnpm --filter @sone/server --prod deploy`, which produces a
# self-contained tree with production dependencies only. It changes the runtime
# layout, and several paths are computed relative to it — the static file root,
# the migrations directory, the backup scripts — so it is a deliberate change
# with its own verification rather than something to slip in here.
#
# Consequence for now: a 272 MB image instead of roughly 246 MB, and TypeScript
# present in a production image. Not a correctness problem; worth fixing before
# 1.0.
RUN pnpm prune --prod || true

FROM node:22-alpine AS runtime
WORKDIR /app

# Baked in at build time: running code has no other way to know which tag
# produced it. Reported by /api/version so an operator can check without
# inspecting the image.
ARG SONE_VERSION=dev
ARG SONE_COMMIT=unknown
ENV NODE_ENV=production \
    PORT=3000 \
    SONE_VERSION=$SONE_VERSION \
    SONE_COMMIT=$SONE_COMMIT

# postgresql-client provides pg_dump / pg_restore, which the backup and restore
# commands shell out to. Without it those commands fail at the moment they are
# needed most. Pinned to the major version matching the compose file's Postgres:
# pg_dump refuses to dump a server newer than itself.
RUN apk add --no-cache postgresql17-client tar \
 && addgroup -g 10001 sone \
 && adduser -u 10001 -G sone -S -h /app sone \
 && mkdir -p /var/lib/sone/files /var/lib/sone/backups \
 && chown -R sone:sone /var/lib/sone

COPY --from=build --chown=sone:sone /app/node_modules          ./node_modules
COPY --from=build --chown=sone:sone /app/packages              ./packages
COPY --from=build --chown=sone:sone /app/db                    ./db
COPY --chown=sone:sone docker/healthcheck.mjs                  ./docker/healthcheck.mjs
COPY --chown=sone:sone docker/entrypoint.sh                    ./docker/entrypoint.sh

USER sone
EXPOSE 3000
VOLUME ["/var/lib/sone/files", "/var/lib/sone/backups"]

# Baked into the image so a bare `docker run` is healthchecked too, not only a
# compose deployment.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD node docker/healthcheck.mjs

ENTRYPOINT ["/app/docker/entrypoint.sh"]
