# ADR-0044: Import, export and backups

## Status

Accepted, and built: subtree export, workspace export as a job, and import with a previewed plan. The shape, vocabulary and order below were decided first, and the build followed them.

## Context

Asked for: import and export, with a list of past exports to download again,
options such as with or without attachments, several formats, a choice of where an
import lands, whether folders are created, and a preview. Suggested: one
Import/Export area in the settings holding all of it, backups included.

The competitive review (docs/competitors.md) puts export fourth of four gaps and
gives the reason it matters more than its position suggests: a self-hosted tool
that cannot hand back its contents in an open format is asking for exactly the
trust the hosted ones ask for. Import decides whether anybody can start at all.

## Decisions

### Three places, not one area

The settings are split by *scope* — you, this workspace, administration
(ADR-0027) — and an area named after a verb would cut across all three. Each of
these operations belongs to a different scope with a different set of people
allowed to perform it, so each goes where that scope lives:

- **A page or a subtree, exported** is an action on that page, not a setting. It
  belongs in the entry's ⋮ menu beside "Move to…". Anybody who may read a page may
  export it: they can already see every word.
- **A whole workspace, exported or imported** goes under **This workspace**, for
  people with `can_manage_workspaces`. It touches everything in it.
- **Backups** go under **Administration**, for the instance admin, and are a
  different thing entirely — see below.

The cost of this is three entry points instead of one. The gain is that nobody
has to learn which of the three things behind one heading they are allowed to
touch.

### A backup is not an export, and the two are never named alike

**An export is for reading elsewhere.** Markdown, HTML, PDF. Lossy by design: no
permissions, no attribution, no Yjs history, no share links. That is correct — a
Markdown file with somebody's access rights in it would be a leak, not a feature.

**A backup is for restoring here.** Lossless: the database and the file store.

Merging them produces the worst failure this application could have: somebody
downloads "the backup", loses the server, and discovers it was Markdown — history,
permissions, comments and attribution gone. A button that produces something
shaped like a backup and isn't is a liability rather than a feature.

So the Administration entry does not offer a backup download. It documents what a
backup is — `pg_dump` plus the file store — links to `docs/deployment.md`, and
reports what it can honestly report: whether the file store is on disk or S3, how
large it is, and when the last maintenance run was. Anything more requires the
server to write archives of its own database, and an operator who has not
arranged backups is better served by being told so than by a button that half
does it.

> **Correction, 2026-09-05 (ADR-0079).** The paragraph above describes a screen
> that was never built. The Administration area reports the last maintenance run
> and nothing else: there is no backup entry, no link to `docs/deployment.md`,
> and no word about the file store — the whole web package contains one mention
> of the word "backup", in an unrelated warning about OIDC secrets. The
> reasoning stands and the description does not, which is the worse of the two
> ways for a record to be wrong: it reads as a description of the product. The
> screen is not built here either; this note is so that the next reader knows
> which sentences are a decision and which are a plan.

### Exports are jobs, and there is no job runner yet

This is the prerequisite, and naming it is most of this record's value.

A workspace export cannot happen inside a request: it reads every document,
resolves every attachment and produces an archive. The server has a maintenance
timer (`maintenance/job.ts`) which runs known tasks on a schedule — it is not a
queue. There is no way to start one long task, follow it, and find out it failed.

So: a small `jobs` table with a kind, a scope, the requesting person, parameters,
a state, a progress figure and an error, worked by the same in-process timer that
already sweeps. In-process rather than a second container, for the reason ADR-0005
gave: one fewer moving part for the operator. One job at a time per instance,
because two workspace exports at once is a memory problem nobody asked for.

Imports are jobs for the same reason, and get it for free.

**The way to have something sooner:** a *subtree* export is small enough to stream
as a ZIP straight into the response, with no job, no archive and no list. That is
worth shipping first — it is the common case, it needs none of the above, and it
proves the format work before the machinery is built.

### An archive is a file in the workspace, with an expiry

A finished export is stored like any other file (ADR-0029): in the workspace's own
store, counted against its usage, served by the same route. Listed with who asked
for it, what it covered, which options, its size and when it expires.

It expires. Thirty days, the same window as the trash (ADR-0027), and for the same
reason: an artefact nobody deleted is not an artefact anybody wants kept for ever,
and an export is a copy of everything — the one file in the system whose leak
costs the most. A stale copy of the whole workspace sitting in storage indefinitely
is a liability that grows.

### An import is a plan, shown before anything is written

Read the source, build a plan, show the plan, and only then write. The plan is a
data structure rather than a screen:

- how many pages, and the tree they will form
- which folders would be created
- what collides with what already exists, and what would happen to it
- how many attachments, and their total size
- what is being skipped, and why

An import that has created two hundred pages by the time somebody notices it
mangled the hierarchy is worse than no import at all — the damage needs undoing by
hand, and the trash was not built for two hundred entries arriving at once.

The plan also decides the destination, which is not free-form: the root holds only
folders (ADR-0019), so an import of loose pages either goes inside an existing
folder or creates one, and the picker enforces that rather than discovering it on
the way.

Executing a plan is one transaction per page, not one for the import: a partial
import that stopped with a clear error and left twelve pages is recoverable. One
giant transaction that rolls back an hour's work on the last file is not.

### Formats, in the order their cost justifies

1. **Markdown with attachments, as a ZIP.** The ownership argument, and the
   cheapest thing here. One folder per branch, one file per page, attachments
   beside them with relative links. Our blocks are close to Markdown already;
   what is not — collections, canvases, videos — is written as a fenced block
   with its data in it, so a round-trip through our own importer loses nothing
   even though another tool would see a code block.
2. **HTML, one self-contained file per page.** A better answer than PDF to "still
   readable in ten years", and nearly free: the page already renders in HTML.
3. **PDF via a print stylesheet**, using the browser's own print. Not a PDF
   library: a renderer of our own would have to lay out collections, canvases and
   videos, which is a second layout system to maintain against the first.

Attachments are optional and the option is per export, because "with
attachments" is the difference between a file somebody can email and one they
cannot.

### Importable sources, in the order they are worth

1. **Markdown** — a folder or ZIP of files, which is what most people can
   produce and what our own export makes. This one closes the round trip.
2. **A SONE export** — the same archive, lossless for the things our fenced
   blocks carry. This is what makes moving between instances possible.
3. **DOCX** and **Notion's export** later, and only if somebody actually arrives
   with one. Both are large, both are somebody else's format changing under us,
   and Docmost's having them is not a reason for us to.

## What is deliberately not decided

**Scheduled exports.** A cron that drops an archive somewhere weekly is a backup
in an export's clothing, and this record's whole first half is about not doing
that.

**Export of a share link's contents by the guest holding it.** Plausible, and it
needs its own thought about what a link is allowed to hand out.

## Consequences

The order of work is fixed by the above and it is not the order the request came
in: subtree Markdown export first (no machinery), then the job runner, then
workspace export with the archive list, then Markdown import with a plan and a
preview. Backups are documentation and one honest status panel, not a feature.

Three menu entries have to be added in three different scopes, and each needs its
own permission check. That is the price of not conflating them.

The `jobs` table is new infrastructure and everything after the first step waits
on it. It is also the thing that makes several later features possible —
re-indexing, bulk moves, a large import — so it is not a cost carried for export
alone.

## Alternatives considered

**One Import/Export area, as suggested.** Rejected above: it spans three scopes
and three permission levels under one heading, and it is where backups would end
up sitting next to Markdown.

**Doing PDF with a library.** Rejected: a second layout system.

**A queue in Redis or a second container.** Rejected for now on ADR-0005's
grounds. One instance, one timer, one job at a time is enough for an application
whose largest export is one workspace. If that stops being true it is a change of
implementation behind the same `jobs` table, not a change of design.
