# ADR-0115: Following a notification

## Status

Accepted. Built. Reported from use.

## Context

> Wenn ich bei einer Benachrichtigung auf den Link klicke um zur Seite zu
> springen muss ich im richtigen Workspace sein, sonst klappt es nicht, es kommt
> die Meldung dass ich keinen Zugriff auf die Seite habe.

Three deliberate decisions meet here, and none of them is wrong:

- **The inbox spans workspaces** (ADR-0052). Being told about a question asked
  somewhere other than where you are standing is the whole point of it.
- **A page URL names no workspace** (ADR-0016). The session carries it, so a
  page moving between workspaces does not invalidate every link to it.
- **The sync connection is bound to one workspace.** `effectiveRole` refuses a
  page in another one before anything else, under the comment "this is the
  boundary that must never leak".

So the row was a correct link, followed on a connection bound somewhere else,
and the page said:

> You no longer have access to this page.

Which was not true, was not actionable, and named the one thing that had not
happened. The HTTP metadata route resolves claims for the *page's* workspace, so
the title and breadcrumb loaded fine — only the document was refused. A page
with a name, no body, and a sentence saying it had been taken away.

**The mechanism to fix it has existed since ADR-0070:**

```tsx
onSwitchWorkspace={(id, to = paths.home()) => {
  selectWorkspace(id);
  if (to !== window.location.pathname) navigate(to);
  void reload();
}}
```

Switch, and land where the caller says. Used by the workspace switcher. Never
called by the inbox, whose rows are the one place in the application that
routinely point across the boundary.

That is the fourth time in this project that the missing part was the caller
rather than the thing: `revokeAccess` written and never called (ADR-0099), the
cache `verifyIdToken` described and nobody held (ADR-0108), `paths.sharePage`
with no callers (ADR-0113), and now this.

## Decisions

### Switching is part of opening

The row's click switches workspace and lands on the page, when — and only when —
the notification is about somewhere else.

**Only when.** Switching to the workspace you are already in tears down the sync
connection and rebuilds it, so an unconditional switch would make every
notification about the workspace you are looking at reconnect. There is a test
for that specifically; it is the counterweight that a fix aimed only at the
report would fail.

**Only a plain left click.** A cmd-click opens a tab, which starts its own
session and lands in its own workspace; switching here would move *this* window
out from under somebody who asked for a second one. The guard is the same one
`useLinkInterception` uses, for the same reason.

**Still a real anchor.** The href is unchanged and the default is prevented
rather than the link being replaced by a button, so middle-click, cmd-click and
"copy link address" go on working — the property ADR-0016 calls a public
contract.

### No workspace chooser on the inbox

Asked for alongside the shares screen, and the answer is different here. The
shares lists really are about one workspace and said so nowhere (ADR-0114). The
inbox is global by design and already filters by workspace in its own panel; a
chooser would be a second answer to a question that screen answers better, and
it would make the global list — the thing the inbox is for — one option among
several.

### A notification can be removed

There was no way to. Reading a row keeps it, snoozing brings it back, and the
one-year ceiling on a snooze exists precisely so that putting something aside
cannot quietly become deleting it:

> a year is where "put this aside" stops meaning that and starts meaning "delete
> it without saying so"

Which is right, and left "I do not want this row any more" with no answer at
all. Asked for as exactly that, about two rows for pages that no longer exist.

**By id, never all of them.** Marking the list read is the bankruptcy
declaration and it is reversible; this is not. An empty `ids` is refused rather
than read as "clear the inbox" — `POST /api/inbox/read` with no ids *does* mean
all of them, so that reading was available and would have been a catastrophe.

**A hard delete rather than a `dismissed_at` column.** A notification is a
message about somebody else's writing, not a record of anything: the comment and
the page are the record and both outlive the row. A tombstone would mean the
table grows forever to remember what somebody asked to stop seeing.

**Not optimistic**, unlike marking read and snoozing. Those are worth doing
optimistically because the worst a failed one costs is a row in the wrong view,
recoverable by looking again. A row that vanished from the screen and stayed on
the server would come back on the next refresh with no explanation; one that
vanished from both when the request failed would be a deletion that did not
happen and cannot be retried.

## What was checked and not changed

**"Stale notifications for pages that no longer exist."** Both inbox queries
already join `pages` and `workspaces` with `archived_at IS NULL` and
`deleted_at IS NULL`, and the count uses the same joins — a badge that disagreed
with the list was fixed earlier and is not this. Deleting a comment thread
removes its notifications on the next projection.

What can survive is a mention or an assignment whose *block* is gone while the
page remains: the thread sweep is guarded by `thread_id IS NOT NULL`, because an
assignment carries a null thread on purpose. Removal now answers that from the
person's side, which is the honest fix for a case whose correct automatic
behaviour is not obvious — a mention of you in a paragraph somebody has since
deleted is still something you may want to have seen.

## Consequences

**Four mounted tests and two route tests.** The mounted ones read what a click
does to the anchor, because "the browser followed the link anyway" is the bug
and a source assertion cannot see a prevented default.

**`page.noAccess` still says the wrong thing** in the case that remains: a
`/p/<id>` URL pasted from a colleague, for a page in a workspace you are in but
not currently looking at. The cause reported is gone; this one is not, and it is
named here rather than fixed because the general answer — landing on any page
switches to its workspace — is a change to the page-fetch path with a redirect
loop in it if the fetch is ever wrong.

## Alternatives considered

**Put the workspace in the notification's URL.** It makes the row
self-sufficient and breaks the rule that a page URL never names a workspace
(ADR-0016), which exists so that moving a page between workspaces does not
invalidate every link to it. A notification is not special enough to be the
exception.

**Switch on arrival instead of on click** — the page fetch already knows which
workspace the page is in, and it would fix a pasted link too. Better, and a
change to the path every page load takes, with a redirect loop available if the
answer is ever wrong. Named above rather than done alongside a reported bug.

**Mark the row read and refuse to open it** when it points elsewhere, with an
explanation. Honest and useless: the reason somebody clicked is that they want
to read the thing.

**Let the sync connection cover several workspaces.** It removes the whole class
— and the connection's authorisation is per workspace by construction, so this
is a rewrite of the boundary `effectiveRole` calls the one that must never leak.
