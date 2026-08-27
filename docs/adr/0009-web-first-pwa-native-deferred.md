# ADR-0009: Web client first, PWA as the first mobile app, native deferred

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Mobile clients were considered for parallel development in a second
repository, natively on both platforms. Investigating what that costs changed
the plan.

Two things drive the cost, and the UI shell is neither of them:

**CRDTs.** There is no Yjs for Swift or Kotlin. There is `yrs`, the Rust port,
which maintains binary protocol compatibility with Yjs and exposes a C FFI;
`YSwift` provides Swift bindings over it via UniFFI, and UniFFI multiplatform
bindings exist for Kotlin. All MIT, the same family as Yjs, so the licence
position of ADR-0004 holds. But YSwift is explicitly work in progress and does
not yet expose everything Yrs can do.

**The editor.** A block editor with slash menu, drag handles, nesting and
inline databases, built natively on TextKit 2 and Compose, is plausibly more
work than the server and web client combined. Craft is iOS-first and was built
by a team; its editor is the reason the app is good.

Beyond cost, there is a sequencing problem. Every change to the document
schema would be paid three times — server, web, mobile — and the schema will
keep moving until collections are settled in stage 3. Parallel development
before then means writing the same migration three times and missing it twice.

## Decision

Build the web client first. Its first mobile form is a PWA.

Native mobile is deferred, and no `sone-mobile` repository is created yet. An
empty repository is an open task that rots; this ADR is the cheaper way to keep
the reasoning. When mobile starts, it is **one** repository with both
platforms, not one per platform — they share the Rust core and every product
decision.

Conformance test vectors are also deferred. Their only justification was a
second implementation of document interpretation; with one implementation the
work has no payoff. They become mandatory the moment a second client exists.

Two constraints on the web client follow from this and are binding now:

1. **Touch and narrow viewports from the start.** Not desktop-first with a
   mobile pass later. For an editor with drag handles and a slash menu, that
   retrofit is half a rewrite.
2. **Sync and store logic stays out of the React components.** Its own package,
   not hooks scattered through the client. Then a later native app is a
   different surface over the same logic rather than an excavation.

## Consequences

The first mobile experience costs almost nothing beyond the web client, if the
two constraints above are honoured. If they are not, the PWA is bad and native
becomes urgent for the wrong reason.

The PWA has real limits, and they define when native is actually due: iOS
evicts web storage under memory pressure, background sync is weak, and file
access is restricted. Good enough for reading and light editing. Not good
enough for an app that must reliably hold a day's offline work.

At that point the plan is a shared Rust core — `yrs`, document interpretation,
sync client, local SQLite — exposed through UniFFI, with native UI on both
platforms. The document *interpretation* belongs in that core; the SQL writing
does not, since mobile projects into SQLite and the server into Postgres.

That implies re-implementing `readDocument`, the value mapping and plain-text
extraction in Rust, with the server calling them via napi-rs. A real rebuild,
deliberately not started now: the TypeScript version works and is tested, and
doing it before the schema settles would mean doing it twice.

## Alternatives considered

**Two fully native apps in parallel, starting now.** Rejected on sequencing:
the schema is not stable enough, and one developer cannot carry three clients
through a moving schema.

**Compose Multiplatform for a single native-compiled UI.** Halves the UI work
and avoids a WebView. Rejected because iOS would not feel first-class, and
Craft-grade feel on iOS is the stated bar.

**Flutter.** AppFlowy's choice, and its editor is among the complaints that
motivated SONE.

**Native shell with a WebView for the editing surface only.** Not adopted, but
explicitly reserved as the fallback for the hardest surfaces — inline database
editing, tables — if a fully native editor stalls. It is not a web app: the
navigation, lists and database views stay native. Reserving it may be the
difference between that stage shipping and never shipping.
