# ADR-0109: Three places hold a key

## Status

Accepted. Built. The last open point on `claude/durchgang-nie-gelaufen.md`.

## Context

ADR-0080 named this and left it: purging a deleted workspace removes its `files`
rows by cascade and leaves every attachment on the disk, permanently. ADR-0106
did the equivalent for CRDT documents; this is the other half, and it is the
easier one — the join is a stored column, not a hash.

Three references in the codebase asked for this sweep before it existed.
ADR-0080 counted them, corrected two, and left the third — which is the only one
written into the schema, where somebody reading the database would find it.

## What the schema asked for is not what was needed

`db/migrations/0025`, on `file_variant`:

> Checked by the orphan sweep: a row with `variant_of` set is reachable through
> its original and must not be collected on its own.

That describes a sweep over **rows**: files no block refers to. Blocks live in
CRDT documents rather than in SQL, so such a sweep would have to read every
document to decide anything — and it would be deciding whether somebody's
attachment is still wanted.

What was actually needed is a sweep over **bytes**: objects in storage that no
row names. Under that, a variant is safe because it has a row of its own, for
exactly the same reason as any other row, and the comment's reasoning does not
apply at all. It is corrected in migration 0071 rather than deleted, because the
sentence records what somebody expected and the next person considering a
row-level sweep should find out there that a byte-level one exists.

## The trap: three places hold a storage key

| | |
|---|---|
| `files.storage_key` | attachments |
| `users.avatar_key` | profile pictures — **not in the `files` table at all** |
| `jobs.result->>'key'` | a workspace export waiting to be downloaded |

Missing any one of them deletes live data, and the avatar is the one the
application points straight at. `files/routes.ts`, on replacing a picture:

> The previous one is left in storage for the orphan sweep rather than deleted
> here. Content-addressed keys mean two people with the same picture share one
> file, and deleting on replace would take the other person's.

A sweep reading only `files` would collect **every profile picture on the
instance** — invited to it by the comment asking for it. That comment is now the
one with a test named after it.

The export is the one that hides: its key is inside a `jsonb` column, because
"an archive is a file, and a bytea column holding a workspace is a backup nobody
chose to take".

### And two properties of the storage itself

**Keys are content hashes**, so one file can have many rows. The question is
"does *any* row name this key", never "does this row still exist" — deciding per
row is the mistake the avatar comment describes avoiding on replace, and there
is a test for it.

**The store lists only what it wrote.** A `lost+found`, an editor's dotfile, a
directory somebody mounted underneath — none of it came through `put`, and a
sweep that removed it would be deleting from a directory it does not own.
`FileStore.list` draws that line at the same key pattern `resolve` refuses to
look past.

## Decisions

### `FileStore` gains `list`

It could not be asked "which of these does the database still name" without
being able to say what *these* are. One method, returning key, size and
modification time — the last because it is what keeps an upload in flight out of
a sweep's reach.

`store.put` happens *before* the `INSERT INTO files`, so between them a live
upload has bytes and no row. The same window `createEntry` has, and the same
reason the document sweep waits a week.

### The live set is read before the listing

A row written while the sweep runs then appears in the set, and its file is not
a candidate. The other order would let a file arrive after the listing and be
judged against a set that predates it. Both orders are wrong for something; this
one is wrong in the direction of keeping a file.

### The job reports, a script removes

`orphanedFiles` joins the anomaly counts, and `sweep-orphan-files.mjs` does the
removing — dry run by default, a week's age, a limit. Exactly the split
ADR-0106 made, for the same two reasons: the cause needs an operator, and a task
that deletes somebody's attachments every five minutes while nobody is looking
is the wrong home for it however careful the query.

`orphanedFiles` is `null` rather than `0` when the process has no store to ask.
"Did not look" and "looked and found none" are different answers — the
distinction ADR-0079 introduced `fileStorage` for, and the one ADR-0107 found
being got wrong two releases later.

### Not called from the purge

The purge's comment now says so. A purge is not the moment to decide to delete
bytes, and it is the one place where a mistake would be attached to somebody
having removed a workspace on purpose.

## Consequences

**Eleven tests, all eleven failing before the change**, and seven of them assert
what the sweep must *not* take: an avatar, an export archive, a file two rows
share, a variant, a file written a moment ago, a path that is not a storage key,
and — in the dry run — anything at all.

**Three stale references become one accurate one.** The two code comments now
name the mechanism and what it knows; the schema comment says what the sweep
actually is, and that it is not the sweep it originally imagined.

**`claude/durchgang-nie-gelaufen.md` has no open points left.** The eleven areas
it opened with are closed, and so are the seven things it listed as named but
not built — three of which turned out to be misdescribed rather than missing.

## Alternatives considered

**A sweep over rows, as migration 0025 imagined.** It has to read every CRDT
document to learn which files a page still refers to, and then decide that an
attachment nobody links is unwanted — which it may not be: a file can be
unlinked from a block and re-linked, and an import writes rows before blocks.
The byte-level question has an exact answer; the row-level one has an opinion.

**Delete the bytes from the purge, in the same transaction.** Tempting, and it
is the one deletion where a mistake is attached to a deliberate act by an
operator. It also means the purge holds the store, the file deletions cannot be
rolled back with the transaction, and a shared file — two workspaces, one
picture — needs the same "does any row name it" question asked under a lock.

**A recurring maintenance task instead of a script.** No operator would have to
know it exists, and the first future column holding a storage key becomes silent
data loss on a schedule, at 03:00, with no report anybody read.

**Reference counting on the file row.** A count is a second answer to a question
the rows already answer, and it goes wrong exactly once — quietly, in the
direction of deleting something.

**Keep `users.avatar_key` in the `files` table** so there is one place to look.
The right shape, probably, and a migration that moves live data for the sake of
a sweep that can already read two columns. Named here rather than done in
passing.
