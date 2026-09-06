# ADR-0106: The join that was not available

## Status

Accepted. Built. The first of the three surviving items on
`claude/durchgang-nie-gelaufen.md`, which ADR-0105 checked and found true.

## Context

ADR-0080 fixed a purge that removed a deleted workspace's page rows and left
every byte of every page behind — `doc_updates.doc_id` and `doc_snapshots.doc_id`
carry no foreign key to `pages`, deliberately, because a CRDT update can arrive
before the row it belongs to. It then named what it had not done:

> An instance that has ever purged a workspace still holds its content. This
> change stops it happening again; it does not clean up what is already there,
> and nothing in this release does. That is a real gap and it is named here
> rather than quietly left: those rows have no workspace, no page and no owner,
> so a sweep for them is a query over `doc_updates` with **no join available** —
> it would have to work from "doc_id matches no page and no page's internal
> document", which is exactly the shape of query that is one mistake away from
> deleting live data. It deserves its own record, its own tests, and a dry run
> that reports before it removes.

Every sentence of that is a good description of the problem. The premise is
wrong, and it is worth saying exactly how, because the mistake is a natural one.

## The join is available

A `doc_id` is one of two things and nothing else: a page's id, or the id of that
page's **internal comments document** (ADR-0057) — a UUIDv5 *derived* from the
page id rather than stored, so nothing has to be kept in step and no row can go
missing while its updates remain.

Derived means one-way. From a stray `doc_id` you cannot ask which page it came
from, and that is what makes the join look absent. But the question does not
need that direction: the legitimate set is

```
{page id} ∪ {internal_doc_id(page id)}   over the pages that exist
```

and both halves are computable *forwards*. An anti-join against that set is the
whole sweep.

The reason it reads as impossible is that half the join is a hash, and a hash
suggests you cannot join on it. You cannot join *back* through it. You can
compute it and join on the result.

### What the warning is right about

`doc_id NOT IN (SELECT id FROM pages)` — the obvious way to write this — names
**every internal comments document on the instance**, because none of them is a
page id. That query deletes the internal comments of every page on the server:
the ones written where the page's own readers cannot see them, which ADR-0080
itself calls "the copy of a deletion most worth actually performing", and is
therefore the copy most worth not performing by accident.

There is a test that runs that query and asserts it names a live document — the
trap, demonstrated, next to the version that does not fall into it.

### And a second thing it is right about

A document with no page is not necessarily an orphan. `createEntry` appends the
first update and materialises the page in a **separate transaction**:

```ts
const seq = await appendUpdate(pool, id, Y.encodeStateAsUpdate(doc), input.actorId);
await withTransaction(pool, (client) => materializeYDoc(client, id, doc, { … }));
```

Between those two statements a perfectly live document has no row, and if the
materialisation throws it has none for good. So the age condition is not
decoration — it is the thing standing between this sweep and somebody's page,
and it has a test that writes a document with no page *now* and asserts the
sweep will not touch it.

## Decisions

### The derivation is written twice, and a test binds them

The view needs `internalDocId` in SQL. `deleteDocuments.ts` says out loud that
re-deriving it elsewhere would be a second implementation of the rule — and this
is one.

It is the trade ADR-0080 made for `retryDelayMs`, in the same area, for the same
reason:

> `retryDelayMs` stays, as the readable statement of the rule, and a test binds
> it to the SQL that ships. Deleting it would leave the query unchecked; keeping
> it unbound was worse than either.

So `internal_doc_id(uuid)` mirrors the TypeScript, and a test computes both over
a set of ids and asserts they agree. **Two implementations bound by a test are
not two answers; two implementations nobody compares are.**

### A view names them; the job counts them; a script removes them

`orphaned_documents` joins the three anomaly views that already exist, and the
maintenance job counts it with an hour's grace exactly as it counts the other
three.

The removal is a script, run by an operator, reporting by default. Two reasons,
and only the first is shared with the existing anomaly counts:

- their cause needs a person, and silently repairing hides it;
- and this one deletes CRDT content. A task that performs "the query one mistake
  away from deleting live data" every five minutes while nobody is looking is
  the wrong home for it, however correct the query is today. The population is
  historical, so there is nothing that needs doing on a schedule.

The log line names the script, because unlike the other three anomalies there
is one to name.

### A week, not an hour

The count grants an hour, like its neighbours, because it produces a number for
somebody to read. The sweep defaults to a week, because it deletes: the
interesting population is years old, so the distance costs nothing.

## Consequences

**Nine tests, all nine failing before the change**, and six of them are about
what the sweep must *not* take: a live page's document, a live page's internal
comments, a document that arrived before its page, the naive query's trap, the
dry run, and the limit.

**An instance can now be told what it is holding without being changed.** The
log line and the view answer "is there anything left from before 0.11.x" for an
operator who has no idea whether their instance ever purged a workspace.

**`docs/deployment.md` had "two things it still does not do" and now has one.**
The remaining one is the file orphan sweep — attachments of purged workspaces,
still permanent, still named.

**A false claim in the schema survives this round.** `db/migrations/0025` has a
column comment reading "Checked by the orphan sweep", about a mechanism that has
never existed — the third of the three references ADR-0080 counted, and the one
nobody has corrected. ADR-0104's guard does not catch it: that one enforces
`Superseded` markers, not promised mechanisms. Named here rather than fixed in
passing, because the file sweep is its own record.

## Alternatives considered

**Compute the legitimate set in JavaScript and hand it to SQL**, avoiding a
second implementation of the derivation entirely — stream page ids, derive both
per page, fill a temp table, anti-join. Correct, and it makes the count
impossible to have cheaply: the maintenance job would build a temp table of
every page id, every pass, to produce a number that should be zero. The
duplicated derivation is bounded by a test; the duplicated work would not be
bounded by anything.

**A maintenance task that sweeps automatically.** No operator would have to know
this exists. And the first future document kind that is not a page becomes
silent data loss on a schedule — with no dry run, because nobody is watching a
task at 03:00.

**Add the foreign key and let the cascade do it.** It is absent on purpose:
migration 0003 explains that a constraint would reject data that is merely
early, and `createEntry` writes exactly that shape on every page created.

**Store the internal document's id on the page row** so the join is trivial.
That is the "row that can go missing while its updates remain" the derived id
was chosen to avoid — and the failure mode is the one this ADR is cleaning up
after.

**Leave it, and let the space be reclaimed by a restore.** Which is what an
instance has had to do for eleven migrations: the only way to shed the content
was to dump, drop and restore. That is a plausible answer for disk and no answer
at all for "are my notes still on this server", which is the question ADR-0080
quotes the deployment guide promising an answer to.
