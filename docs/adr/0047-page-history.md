# ADR-0047: Page history

## Status

Accepted, and built: versions, the history panel, and restoring forward.

## Context

The second of the four gaps the September review named, and the one I described
there as cheap: "we have a complete history already — every document is a Yjs
log, which is strictly more than a list of versions. What we do not have is any
way to *see* it."

That was wrong, and finding out why is most of this record's value.

`compactDoc` folds a document's updates into one snapshot and then **deletes the
updates it folded in** (ADR-0002, for the reason that a cold open should not
replay a growing list). So the log reaches back only to the last compaction,
which for an active page is minutes. Everything before that exists as a single
collapsed state with no intermediate steps at all.

Garbage collection compounds it: documents load with Yjs's default `gc: true`, so
deleted content is dropped from the in-memory document. The stored updates still
carry it — replaying them into a `gc: false` document would reconstruct the
past — but only for updates that have not been compacted away.

So the choice is not "how do we show the history we have". It is "what do we keep,
knowing that keeping everything is what ADR-0002 deliberately refused".

## Decisions

### Versions are kept deliberately, not derived from the log

A `page_versions` table: the document id, the sequence it covers, the encoded
state, when it was taken, and who had written since the previous one.

Not the log. The log is a sync mechanism with a short memory by design, and
building a feature on the assumption that it remembers would produce a history
that silently ends a few minutes ago — which is worse than no history, because
somebody would trust it.

### A version is taken when a sitting ends, and always before compaction

Two triggers, and the second is the one that makes this correct:

**Before compaction.** `compactDoc` is the moment history is about to be
destroyed. Taking a version there means the thing that discards the past cannot
run without first recording it — a guarantee rather than a schedule.

**When a sitting ends.** The maintenance job takes a version of any document that
has changed and then been quiet for a while. "A while" is the gap between "still
writing" and "finished for now", and it is what makes a list of versions read as
a list of *moments* rather than of keystrokes.

Never on every update. A version per keystroke is a list nobody can use and a
table that outgrows the documents it describes.

### Restoring applies the old state forward; it never rewinds

A CRDT cannot be rolled back. Restoring computes what the document would have to
change to look like the old version, and applies that as a **new** update.

Which means: the restore is itself in the history, it can be undone by restoring
the version before it, and anybody connected at the time sees it arrive like any
other edit rather than having their session invalidated. Rewinding the log would
mean rewriting a history other clients have already merged, which a CRDT has no
way to express.

It also means a restore is *not* a deletion of what happened in between. That is
the honest behaviour and it has to be said in the interface, because "restore" in
most applications means the opposite.

### Thinning, and an honest limit

Versions are kept: every one from the last day, one per hour for the last week,
one per day for the last ninety days. Older ones are dropped by the maintenance
job.

A retention window is a promise, so it is a setting
(`SONE_VERSION_RETENTION_DAYS`) and the interface says what it is rather than
letting somebody discover the limit when they need it.

The limit that cannot be tuned away: **history begins when this is switched on.**
Every existing page has one collapsed state and no past, and no amount of work
recovers what compaction already discarded. The interface must say that for a
page whose first version is younger than the page — the same discipline
attribution follows (ADR-0022), and for the same reason: a record that implies it
is complete when it is not is worse than a short one that says so.

### Looking at a version is read-only, and clearly a different thing

A version opens in place of the page's body, marked, with no editor. Not a diff
view in the first pass: a readable past state answers "what did this say on
Tuesday", which is what people ask, and a diff answers "what changed", which is a
second feature with its own design (word-level marks, moved blocks, tables).

Comments and canvases come with the version, because they are in the same
document. A thread attached to text that the version predates simply has nothing
to anchor to, which the detached state already covers (ADR-0046).

## What is deliberately not decided

**Diffs between two versions.** Wanted, and its own record: word-level
comparison of ProseMirror documents is not a small job and it needs the reading
view to exist first.

**Naming a version.** "Before the client call" is obviously useful and needs a
decision about who may name and rename one.

**Restoring one block rather than the page.** Plausible, and it needs the diff.

## Consequences

Storage grows per page rather than per edit, which is the point, but it does
grow: a page edited every day for a year keeps roughly a hundred states. Since a
state is a compacted update rather than a text file, that is smaller than it
sounds — and the thinning is what bounds it.

`compactDoc` gains a responsibility and must not be callable without it. That
belongs in the function rather than in its callers: a second caller that forgot
would destroy history silently.

The maintenance job grows a third task beside pruning and compaction, and the
"has been quiet for a while" check needs the last-edited time it already has.

## Alternatives considered

**Keep every update for ever and derive versions from the log.** The honest
"complete history", and rejected: ADR-0002 refused exactly this because a cold
open replays what it finds, and the fix for that would be a snapshot — which is
what this record stores anyway, with a bound.

**Turn off garbage collection so the past is always reconstructible.** Rejected:
it makes every document carry every deleted character for ever, in memory, on
every open, for a feature that wants a hundred states rather than a million.

**Version on every save, as an editor would.** There is no save. A CRDT document
is always saved, which is precisely why "when did this become a version" had to
be decided rather than inherited.
