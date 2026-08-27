# ADR-0017: Pin ProseMirror instead of vendoring it

- **Status:** Accepted
- **Date:** 2026-08-27
- **Amends:** ADR-0004 (the vendoring mechanism, not its principle)

## Context

ADR-0004 decided to vendor ProseMirror as a git subtree rather than depend on
it through npm. The principle behind that decision stands and is not in
question: SONE must not be exposed to a dependency being restricted or
monetised out from under it.

The mechanism turns out to be wrong, and this became clear on starting the
work.

ProseMirror is not one repository. It is nine, each published separately:
`prosemirror-model`, `-state`, `-view`, `-transform`, `-commands`, `-keymap`,
`-history`, `-inputrules`, `-schema-list`. Several have moved from GitHub to the
author's own forge at `code.haverbeke.berlin`. Vendoring means nine git
subtrees, nine build integrations, nine places to pull upstream security fixes
into by hand, and a dependency graph maintained manually instead of resolved.

Set against that, look at what vendoring actually protects against:

| Risk | Does vendoring help? |
|---|---|
| Upstream relicenses future versions | No. Published MIT versions stay MIT forever; a pinned version is already immune. |
| Upstream moves features behind a paywall | No. Same reason. |
| Upstream is abandoned | No. Vendoring at that point works just as well, from the version already pinned. |
| A version is unpublished from npm | Marginally. A committed lockfile plus a registry cache covers it. |
| A malicious release is published | No. Pinning exact versions covers it; vendoring an unreviewed subtree does not. |

Vendoring buys almost nothing that pinning does not, and costs ongoing
maintenance on nine repositories. That is a bad trade, and it was made before
looking at how ProseMirror is actually distributed.

## Decision

Depend on ProseMirror through npm, with **exact** versions — no `^`, no `~`.
The lockfile is committed.

Vendoring remains the answer if upstream ever goes bad; it is simply not done
pre-emptively. The fork procedure is written down so it is a known operation
rather than an emergency:

1. `pnpm pack prosemirror-<name>@<pinned version>` to obtain the exact tree
   already in use.
2. Add it under `vendor/` and point the workspace at it via a `pnpm.overrides`
   entry.
3. Nothing else changes: the pinned version is what was being used anyway, so
   the fork starts from a known-good state rather than from a moving target.

To make a licence change visible rather than something to remember to check,
`scripts/check-licences.mjs` walks the production dependency tree, fails on any
licence outside an allowlist, and writes a committed snapshot to
`docs/dependency-licences.md`. A licence change then appears in a diff at
upgrade time, which is when it can still be acted on.

The rest of ADR-0004 is unaffected. In particular: no Hocuspocus, the sync
server stays written directly against `yjs` and `y-protocols`, and database rows
are not ProseMirror nodes.

## Consequences

Nine dependencies instead of nine subtrees. Upgrades are deliberate: an exact
version does not move until someone changes it, so an upgrade is a reviewed
commit rather than something that happens during an unrelated install.

Exact pinning means no automatic patch updates, including security patches. That
is the intended trade — a surprise change in an editor's transform layer is
worse than a delayed patch — but it makes the licence and version snapshot
something that has to actually be looked at, not merely generated.

The honest summary of what changed: the earlier decision was made about a
dependency I had not yet examined closely enough. Recorded rather than quietly
reversed, because the reasoning matters more than the conclusion, and because
"vendor everything" is exactly the kind of principle that sounds prudent while
costing more than the risk it addresses.

## Alternatives considered

**Vendor all nine as subtrees, as originally decided.** Rejected on the cost
analysis above.

**Vendor only `prosemirror-model` and `-state`**, the packages carrying the
document semantics. Rejected as the worst of both: partial protection, and a
split dependency graph where some ProseMirror packages resolve from `vendor/`
and others from npm, which is a version-skew bug waiting to happen.

**Depend on a bundled distribution** such as a single package re-exporting all
of ProseMirror. Fewer entries, but adds a maintainer between SONE and upstream
— which is precisely the exposure ADR-0004 exists to avoid.
