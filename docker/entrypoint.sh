#!/bin/sh
# Apply pending migrations, then start. Migration on start is deliberate:
# a self-hosted product that requires a manual migration step after every
# upgrade will be run un-migrated by somebody.
set -e
echo "SONE: applying migrations"
node packages/server/scripts/migrate.mjs
echo "SONE: starting server"
exec node packages/server/dist/main.js
