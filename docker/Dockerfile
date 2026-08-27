# SONE production image.
#
# Multi-stage: the build stage carries the toolchain, the runtime stage does
# not. Runs as a non-root user; the files volume is the only writable path.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json      packages/core/
COPY packages/editor/package.json    packages/editor/
COPY packages/server/package.json    packages/server/
COPY packages/web/package.json       packages/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm prune --prod

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

RUN addgroup -g 10001 sone \
 && adduser -u 10001 -G sone -S -h /app sone \
 && mkdir -p /var/lib/sone/files \
 && chown -R sone:sone /var/lib/sone

COPY --from=build --chown=sone:sone /app/node_modules ./node_modules
COPY --from=build --chown=sone:sone /app/packages     ./packages
COPY --from=build --chown=sone:sone /app/db           ./db
COPY --chown=sone:sone docker/healthcheck.mjs         ./docker/healthcheck.mjs
COPY --chown=sone:sone docker/entrypoint.sh           ./docker/entrypoint.sh

USER sone
EXPOSE 3000
VOLUME ["/var/lib/sone/files"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
