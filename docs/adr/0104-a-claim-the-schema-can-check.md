# ADR-0104: A claim the schema can check

## Status

Accepted. Built. The last open point in `claude/rechte-und-zugriff.md`, and the
first one in four rounds that was neither stale nor wrong — only proposed for
the wrong thing.

## Context

The open point:

> Es gibt **keinen mechanischen Wächter** gegen den nächsten kopierten „das hat
> die Liste schon ausgeschlossen"-Kommentar. Denkbar wäre ein Skript, das jedes
> wörtliche `restrictedAt: null` gegen eine Liste erlaubter Stellen prüft — noch
> nicht gebaut, und die Frage ist, ob es mehr Lärm als Nutzen ist.

It names the right disease. ADR-0089 found a comment copied to seven places that
justified skipping a check, true at one of them and load-bearing at all seven;
ADR-0102 found "Nothing reads it" written into the database about a column two
routes were reading; ADR-0103 found "reading them needs `roles.manage`" written
about a route that had accepted two rights for three ADRs, with a form built
around the belief.

**Three in three rounds, all the same failure**: a comment asserting a fact
about *other code*, correct when written, never re-read when the other code
moved.

The proposed cure does not fit it. There is **one** literal `restrictedAt: null`
left in the codebase — counted, not guessed. A script policing a single call
site is ceremony, and the open point's own doubt ("mehr Lärm als Nutzen") was
the right instinct.

## What is actually checkable

A comment cannot be verified in general; it is prose about arbitrary code. But
one member of this family is different, and it is the one that did the most
damage: **a claim the schema makes about itself, in a place a machine can
read.**

Migration 0058 wrote this into the database:

```sql
COMMENT ON COLUMN workspace_members.role IS
  'Superseded by role_id and is_owner (ADR-0087). Nothing reads it: …'
```

That is not prose in a source file. It is a structured assertion, stored in the
catalogue, that the code does not name this column — and nothing ever asked
whether it was true. It was false on the day it was written and stayed false
through four ADRs about that exact subject (ADR-0102).

This is also an established practice here rather than a one-off: three columns
and a whole table have been marked superseded and later dropped —
`users.avatar_url` (0046), the four mail columns (0050 → 0053),
`workspace_members.role` (0058 → 0069). One of the three went wrong. The next
one is a matter of when, not whether.

## Decision

**A column the schema says it is finished with must appear in no SQL.**

The check reads `col_description` for every column, keeps those whose comment
begins "Superseded", and scans the server's SQL for references to them.

It lives in `sqlColumns.db.test.ts`, which already asks both neighbouring
questions and already owns the machinery for the hard part:

| | catches |
|---|---|
| *no statement names a column the schema lacks* | a column the **code** invents |
| *the schema names no column the code has forgotten* | a column the **schema** invents |
| **this one** | a column the schema says is **finished with**, that the code goes on reading |

Migration 0046 is where the middle row came from — "there is a check that every
column the code names exists; this came from asking which columns exist that the
code never names". The third question is the one between them, and it is the one
that went wrong.

Putting it there rather than in `scripts/` is deliberate twice over: the claim
lives in the database, so the check needs a database; and alias resolution —
turning `m.role` into `workspace_members.role` — is a solved problem in exactly
that file. A script would need a second copy of both, which is the shape this
repository keeps removing from itself.

### No allow-list

A superseded column that something still reads *on purpose* — a compatibility
bridge, say — **is not superseded yet.** It is being superseded, and its comment
should say what still reads it.

That distinction is the whole of ADR-0102: migration 0058 marked the column
finished on the same day it added two bridges that read it. An allow-list here
would have let it go on saying so, which is the failure rather than a case to
accommodate.

### It scans the server's SQL, not the migrations or the tests

A migration that backfills *from* a superseded column is the one statement that
must name it — 0069 does exactly that — and migrations are not scanned. Tests
are not scanned either: a test of a compatibility path names the column on
purpose, and the guard is about what the running server does.

## Verification

Not argued — run.

The checker was applied to the tree as it stood at commit `493d1b3`, **the
commit that added migration 0058 and wrote "Nothing reads it"**, against a
database migrated to 0058:

```
superseded: workspace_members.role
readers:
  auth/standing.ts:      workspace_members.role
  http/auth.ts:          workspace_members.role
  http/workspaces.ts:    workspace_members.role
```

Three files, on day one. The same run against the tree immediately before
ADR-0102 gives the same three. Eleven migrations of a false claim, catchable
from the first minute.

**It is silent today**, and the test says so out loud rather than passing
quietly: no column in this schema is currently marked superseded. A guard whose
only evidence is a green tick is a guard nobody should believe, so it is paired
with a test that watches it catch something — `pages.title`, a real and heavily
read column, marked superseded inside the test and unmarked in a `finally`.
That is the pattern `check-rights-enforced.mjs` already uses and the one this
file already states: *a guard that has never been seen to catch anything is a
guard nobody should believe.*

## Consequences

**The claim now costs something to write.** Marking a column superseded is an
assertion the build checks, so it can only be written when it is true — which
moves the marker from "I intend to stop reading this" to "nothing reads this",
and those were eleven migrations apart last time.

**Two thirds of the family remain unguarded, and that is the honest position.**
"The listing already excluded it" is a claim about a caller; "reading them needs
`roles.manage`" is a claim about a route's guard. Neither is written anywhere a
machine can find it, and a checker that tried to read prose would fail in the
direction this repository fears most — noise, then disbelief, then being turned
off. What is left for those is the practice, now written in
`claude/rechte-und-zugriff.md`: **a comment that explains why something is safe
or unnecessary is load-bearing, and is re-read when the thing it describes is
touched.**

**The proposed guard was not built, with a number rather than an opinion.** One
`restrictedAt: null` remains. If that count rises the argument changes, and this
paragraph is what the next person should re-check rather than trust.

## Alternatives considered

**The script the open point proposed**, over literal `restrictedAt: null`
against an allow-list. It would police one site today. An allow-list of one is a
file people edit to make a build pass.

**Parse the migrations instead of reading the database**, so the check could run
in `pnpm check` without a database. It means tracking which columns a later
migration dropped, and re-implementing alias resolution — two parsers to keep in
step with reality, to move a check one CI stage earlier.

**A dedicated marker** like `[superseded]` instead of matching the existing
wording. Cleaner to match, and neither of the two historical comments would have
carried it. The point is that the claim was *already written*; inventing a new
way to write it starts the clock again.

**Fail on any comment containing "nothing reads"** rather than on the
supersession marker. Catches the exact sentence that was false and nothing else;
the next one will be phrased differently.

**A general "comments must be true" checker.** Not available, and pretending
otherwise would produce a guard that flags prose, which is how a guard gets
switched off.
