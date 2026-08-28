#!/bin/sh
# Start SONE.
#
# Three things happen here, in order: make the data directories usable, apply
# pending migrations, then hand over to the server as an unprivileged user.
#
# ## Why this begins as root
#
# The server must not run as root, and it does not — the last line drops to uid
# 10001 and stays there. But the moments before it need privilege, for one
# reason: a bind-mounted host directory keeps the host's ownership. Docker
# copies an image's ownership into a *fresh named volume* and never into a bind
# mount, so `-v /srv/sone/files:/var/lib/sone/files` arrives owned by whoever
# created it on the host — usually root — and a process running as 10001 cannot
# write to it.
#
# The alternative is telling every operator to chown a directory to a uid they
# have no reason to know. That was the previous design, and it cost real people
# real time: the upload simply failed, and finding out why meant reading a
# container log.
#
# So the container fixes what it can and explains what it cannot.
#
# ## Why this is not a weakening
#
# `su-exec` replaces the shell rather than forking, so no root process survives
# the handover — there is nothing left to escalate to. If `su-exec` is missing,
# `exec` fails and the container exits; it does not fall through to running the
# server as root. That failure mode is the one worth designing for.
#
# An operator who prefers to keep root out of the container entirely can still
# set `user:` in compose. This script notices it is not root and skips straight
# to starting the server, so that choice keeps working — it just means the
# directories have to be writable by that user already.

set -e

STORAGE_DIR="${SONE_STORAGE_PATH:-/var/lib/sone/files}"
BACKUP_DIR="${SONE_BACKUP_PATH:-/var/lib/sone/backups}"
RUN_AS_UID=10001
RUN_AS_GID=10001

if [ "$(id -u)" = "0" ]; then
  for dir in "$STORAGE_DIR" "$BACKUP_DIR"; do
    mkdir -p "$dir" 2>/dev/null || true

    # Only when it is actually wrong. Recursively chowning a large uploads
    # directory on every restart would add minutes to the start of a big
    # instance for no reason.
    owner="$(stat -c '%u' "$dir" 2>/dev/null || echo unknown)"
    if [ "$owner" != "$RUN_AS_UID" ]; then
      echo "SONE: $dir is owned by uid $owner; taking ownership for uid $RUN_AS_UID"
      if ! chown -R "$RUN_AS_UID:$RUN_AS_GID" "$dir" 2>/dev/null; then
        # A read-only mount, or a filesystem that does not carry ownership
        # (some network shares). Said plainly rather than left to surface as a
        # failed upload later.
        echo "SONE: could not change ownership of $dir." >&2
        echo "SONE: uploads will fail unless it is already writable by uid $RUN_AS_UID." >&2
      fi
    fi
  done
else
  echo "SONE: running as uid $(id -u); leaving directory ownership alone"
fi

echo "SONE: applying migrations"
if [ "$(id -u)" = "0" ]; then
  su-exec "$RUN_AS_UID:$RUN_AS_GID" node packages/server/scripts/migrate.mjs
else
  node packages/server/scripts/migrate.mjs
fi

echo "SONE: starting server"
if [ "$(id -u)" = "0" ]; then
  # exec, so the shell is replaced: no root process remains.
  exec su-exec "$RUN_AS_UID:$RUN_AS_GID" node packages/server/dist/main.js
else
  exec node packages/server/dist/main.js
fi
