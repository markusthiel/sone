#!/bin/sh
# SONE — work out the version a build of main should carry.
#
# In shell, not in Node, because this runs in the image workflow where only
# git, docker and a POSIX shell are guaranteed. scripts/check-version.mjs runs
# *this file* rather than a second implementation, so the tested logic and the
# shipped logic are the same thing.
#
# The rule is one sentence: a build of main must sort above the tag it follows.
# It has been broken twice, each time stopping a running instance with a blank
# page, because the version fence correctly read the new build as a downgrade.
#
#   First attempt, "<base>-dev.<commit>": against a release candidate,
#   0.1.0-dev.abc sorts BEFORE 0.1.0-rc.1, because "dev" < "rc".
#
#   Second attempt, raw `git describe`: correct after a pre-release tag, wrong
#   after a stable one. `git describe` on a commit after v0.1.0 gives
#   0.1.0-1-gabc, which semver reads as a pre-release OF 0.1.0 — below the
#   release, and below 0.1.0-rc.1-48-g... too, since "1-gabc" sorts before "rc".
#
# The rule covering both: commits after a stable tag belong to the NEXT patch.
set -eu

described="${1:-$(git describe --tags --long --always 2>/dev/null || echo '')}"
described="${described#v}"

# --long output always ends in -<commits>-g<sha>. Anything else is not describe
# output — a repository with no tags, most likely.
case "$described" in
  *-*-g*)
    sha="${described##*-g}"
    without_sha="${described%-g$sha}"
    commits="${without_sha##*-}"
    base="${without_sha%-$commits}"
    ;;
  *)
    echo "0.0.0-dev.0.g${described}"
    exit 0
    ;;
esac

# Exactly on the tag: that is the tag's version, nothing appended.
if [ "$commits" = "0" ]; then
  echo "$base"
  exit 0
fi

case "$base" in
  *-*)
    # After a pre-release, appending identifiers sorts above it:
    # 0.1.0-rc.1 < 0.1.0-rc.1.3.gabc < 0.1.0
    echo "${base}.${commits}.g${sha}"
    ;;
  *)
    # After a stable release, the commits belong to the next patch. Appending
    # to the released version would produce a pre-release of it, which sorts
    # below the release itself.
    major="${base%%.*}"
    rest="${base#*.}"
    minor="${rest%%.*}"
    patch="${rest#*.}"

    case "$major$minor$patch" in
      *[!0-9]*)
        # Not a version this understands. Obviously odd beats silently
        # inventing a number that sorts wrongly.
        echo "0.0.0-dev.${commits}.g${sha}"
        ;;
      *)
        echo "${major}.${minor}.$((patch + 1))-dev.${commits}.g${sha}"
        ;;
    esac
    ;;
esac
