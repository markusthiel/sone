# ADR-0004: Vendored ProseMirror, no editor framework dependency

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

SONE must not be exposed to a licence or business-model change in a
dependency. The relevant fact: retroactive relicensing is impossible. Code
already published under MIT, MPL or GPL stays available under that licence
forever. The real risk is that *future* versions become restricted and the
project is stranded on a fork it must now maintain.

So the question is not "is it open source" but **what would the fork cost?**

Assessment at the time of writing:

| Dependency | Licence | Risk |
|---|---|---|
| ProseMirror | MIT | Low. Single author, no company, no monetisation pressure, API stable for a decade. Bus factor 1 is the larger concern, and MIT answers it. |
| Yjs, y-protocols | MIT | Low, same shape. |
| Hocuspocus | MIT | Moderate. It is the backend behind Tiptap's commercial cloud. |
| Tiptap | MIT core | Pro extensions already sit behind a paid registry. Precisely the pattern to avoid. |
| BlockNote | MPL core + GPL "XL" | Usable under AGPL, but the split shows the direction of travel. |

## Decision

Build the block layer on ProseMirror and Yjs directly. ProseMirror is vendored
as a git subtree under `vendor/prosemirror`, not consumed as an npm
dependency.

No Hocuspocus. The sync server is written against `yjs` and `y-protocols`
directly — roughly a few hundred lines, and it needs bespoke auth and ACL
logic anyway (ADR-0006).

Database rows are **not** ProseMirror nodes. The `collectionView` block is a
node view that mounts its own renderer querying the materialised tables
directly. Modelling rows as editor nodes collapses past a few thousand entries
and makes selection handling unmanageable.

## Consequences

The block-editor UX that BlockNote would have provided has to be written:
slash menu, drag handles, nesting, block conversion. Estimated two to three
months of additional work up front.

In exchange, SONE depends on two MIT libraries from one author, both small
enough to adopt outright if upstream stops.

The vendored subtree must be revisited deliberately — set a recurring reminder
to pull upstream security fixes. A vendored dependency nobody updates is worse
than an npm dependency.

## Alternatives considered

**BlockNote as an npm dependency.** Fastest path to a working editor. Rejected
on the stated requirement that no external component may later restrict or
charge.

**BlockNote MPL core, vendored from day one, XL features reimplemented.** A
reasonable middle path and the fallback if the ProseMirror block layer proves
slower than estimated. Revisit at the end of stage 2 if needed.

**Lexical.** MIT and Meta-backed, but Meta's record of abandoning frontend
projects makes the bus-factor argument no better, and the ecosystem around
Yjs integration is thinner.

**y-sweet as the sync server.** MIT, Rust, persists to filesystem or S3, and
offers document-level access control via client tokens. Not adopted as a
dependency, but a good reference for the token model.
