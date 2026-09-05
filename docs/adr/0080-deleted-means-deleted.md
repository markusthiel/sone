# ADR-0080: Deleted means deleted

## Status

Accepted. Third of the audits argued for by ADR-0076 and ADR-0077. Corrects
ADR-0027's citation in the maintenance job and the retention promise in
`docs/deployment.md`.

## Context

The maintenance job runs ten tasks unattended, every five minutes, and several
of them delete things. Two of those ten — pruning the auth tables, and the
read-only anomaly counts — are exercised end to end through `runOnce()`.
Everything else is tested one layer below the job, or not at all.

The finding that matters is not a missing test. It is that **the most
destructive task did not destroy enough, and said it did.**

`purgeDeletedWorkspaces` ran `DELETE FROM workspaces` and relied on the cascade.
Its own comment said so: "Everything else follows by cascade: pages, members,
invitations, groups and page grants all reference the workspace." Members,
invitations, groups and grants do. **Pages do, and their content does not.**
`doc_updates.doc_id` and `doc_snapshots.doc_id` carry no foreign key to `pages`
— deliberately, because a CRDT update can arrive before the row it belongs to
and a constraint would reject data that is merely early (migration 0003).

So a purged workspace lost its page *rows* and kept every byte of every page
body, forever: invisible to every view and route, unreachable, unreclaimable,
and still growing the database. Against a paragraph three lines above the bug
that reads:

> after that it is gone in the way "deleted" is normally understood — which
> matters when somebody asks whether their notes are still on this server.

`docs/deployment.md` makes the same promise to operators. Neither was true.

**This is the second time.** The page-delete route carries a comment saying
exactly this, ending "Found by a test asserting the updates were gone, which
they were not." That fix was applied where it was found and nowhere else, and
the knowledge stayed in a comment in one route instead of in a function.

**And the route that was fixed was still half wrong.** A page's internal
comments (ADR-0057) live in their own document whose id is *derived* from the
page's rather than equal to it. Deleting "by page id" therefore never touched
them — in the purge or in the route. Internal comments are the ones written
where the page's readers cannot see them, which makes them the copy of a
deletion most worth actually performing.

The existing test is the reason none of this was caught, and its shape is worth
naming: `purging takes what the workspace held with it` asserts that the `pages`
rows are gone. They always were. It is the same assertion that missed this once
already in the route.

Four smaller findings, each a case of the job knowing something and not saying
it:

**`SONE_VERSION_RETENTION_DAYS` had no clamp.** Read straight out of the
environment with `Number()`, never through `config.ts`, unlike
`workspaceRetentionDays` which has had `Math.max(1, ...)` from the start. `0`
made the thinning predicate `taken_at < now()` — the entire version history of
every page on the instance, gone on the next five-minute tick, in one
unrecoverable statement. A non-number reached Postgres as `"NaN days"` and threw
inside a task whose failures are swallowed.

**A failed compaction went to `console.error` and nowhere else.** A pass in
which all twenty-five compactions failed returned `errors: []`, and the
administration panel said "compacted 0 documents" — which is also what a healthy
instance with nothing to compact says. The batch is ordered by backlog size, so
a document that always fails sits at the top of it forever and starves the live
ones, silently.

**Nothing in the interface read `report.errors` at all.** A pass in which every
single task threw rendered identically to a clean one. The sentence it did
render was assembled in English in the component, with an `s` appended by hand,
on a screen that is otherwise translated.

**The "entries inside pages" check had no grace period,** while its own comment
said it did — "given a grace period for the same reason as orphans: CRDT updates
arrive in any order, so a violation that is minutes old is probably still
resolving." The orphan check above it has the hour; this one counted rows that
were about to correct themselves. Migration 0014 exists because this same view
once reported correct data as a violation, and records what that costs: "a check
that reports correct data teaches people to ignore it, and the next real
violation goes unnoticed among the false ones."

And one about testing rather than about the job: **`retryDelayMs` had two tests
and no callers.** The backoff that runs is an SQL expression inside
`retryFailedProjections`. The suite proved the copy nobody runs.

## Decision

**Deleting the documents for a set of pages is one function.**
`deleteDocumentsFor`, which knows both that the rows have no foreign key and
that a page has a second document. The purge and the page-delete route both use
it; neither can take half of it, and the reasoning lives with the code rather
than in a comment in one caller.

The purge does it in **one transaction**, reading the page ids before the
workspaces go — afterwards the cascade has removed the only link that could
answer which documents belonged to them. A failure between the two halves
leaves the workspace marked and intact rather than emptied of its content and
still listed.

**A test that asserts a deletion asserts what was supposed to be deleted**, and
one asserts the opposite: a live workspace beside a purged one keeps everything.
A delete that takes too much is the failure nobody recovers from, and the purge
now selects through a join that could, in principle, be wrong.

**`VERSION_RETENTION_DAYS` is clamped to at least a day** and falls back to
ninety on anything that is not a finite number.

**Compaction failures go into `report.errors`, and the panel shows them**,
through `t` like everything else on that screen. A count of zero and a wall of
failures no longer look the same.

**The "entries inside pages" count gets the hour its comment promised**
(migration 0056 adds `created_at` to the view).

**`retryDelayMs` stays, as the readable statement of the rule, and a test binds
it to the SQL that ships.** Deleting it would leave the query unchecked; keeping
it unbound was worse than either.

## Consequences

**An instance that has ever purged a workspace still holds its content.** This
change stops it happening again; it does not clean up what is already there, and
nothing in this release does. That is a real gap and it is named here rather
than quietly left: those rows have no workspace, no page and no owner, so a
sweep for them is a query over `doc_updates` with no join available — it would
have to work from "doc_id matches no page and no page's internal document",
which is exactly the shape of query that is one mistake away from deleting live
data. It deserves its own record, its own tests, and a dry run that reports
before it removes.

**There is no orphan sweep for files.** The purge's comment said workspace files
were "left to the orphan sweep that already exists"; `files/routes.ts` says the
same about superseded uploads; ADR-0079 found `backup.ts` claiming an
orphaned-file report "that was never written". Three places refer to a mechanism
that has never existed. The comment no longer claims it, and the gap is named:
every purged workspace's attachments stay on disk permanently.

Still unexercised in this area, named rather than fixed: `versionQuietDocuments`
and `pruneShareSessions` have never been executed by any test; the `store` and
`sync` wirings are never supplied in a test, so two of the ten tasks never run
inside the job; and the admin `run` and `retry` routes have no test. The job's
`this.running = false` is not in a `finally` — latent today, and if it ever trips
the job disables itself permanently and reports it in a field nothing renders.

The pattern from ADR-0078 and ADR-0079 holds here in a third form. There it was
a seam with no test, and a backup that knew something and did not write it down.
Here it is a fix applied where it was found and not where it belonged — which is
the same failure as a rule with two copies, arriving from the other direction.
