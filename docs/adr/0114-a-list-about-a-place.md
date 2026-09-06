# ADR-0114: A list about a place

## Status

Accepted. Built. Reported from use.

## Context

> Die Freigaben sind nicht konsistent. Ich habe einen Link geteilt und der
> erscheint nicht in der Liste. Mal erscheinen sie, mal nicht. Auf einmal sind
> da von mir geteilte Seiten dann für mich freigegebene Seiten.

Two faults, and only one of them is what it looks like.

## The screen is about a workspace and never says so

All three lists come from `GET /api/workspaces/:workspaceId/shares`. The
workspace is a path parameter, filled from the one id `useSession` remembers in
`localStorage`. The route `/shares` carries no workspace, the panel head is a
plain title, and there is no switcher anywhere on the screen.

So a link created a moment ago in another workspace is *absent*, correctly, with
nothing on screen to suggest the list is about somewhere else. "Mal erscheinen
sie, mal nicht" is that, exactly: the same screen showing two different worlds
and looking identical doing it.

The trash has the identical shape, and named its workspace in a line of prose —
which is better than nothing and still leaves somebody who wants the other one
with no way to get there.

**The answer was already written down**, in the comment beside `panelChooser`:

> The Workspaces mode says its scope with a control rather than a line: which
> workspace is not a fact to read here, it is the choice the rest of the column
> depends on (ADR-0070).

That is the argument for shares and for the trash, in the file, next to the
branch that gives the control to exactly one mode.

## And a grant to a group you are in was in both lists

`granted` matches `granted_by = me`. `received` matches `pp.user_id = me` or
`gm.user_id = me` through a group. Those are not exclusive: share a page with a
team you are on — the ordinary way to give a team access — and the same row is
in both, the second one saying it was shared with you by yourself.

That is "auf einmal sind da von mir geteilte Seiten dann für mich freigegebene
Seiten", and it is not intermittent at all; it happens every time, for the most
common way of sharing there is.

## Decisions

### The two per-workspace modes get the switcher

`WorkspaceMenu` in `panelChooser` for `shares` and `trash`, landing on the same
route — the Workspaces mode carries its section across a switch for the same
reason: the question did not change, only what it is being asked about.

**The inbox deliberately gets none.** It spans workspaces (ADR-0052) and already
filters by them in its own panel; a chooser there would be a second answer to a
question that screen answers better. The user asked whether the same treatment
should apply there, and the honest answer is no — the inbox's problem is
navigation, not scope, and it is ADR-0115's.

`trash.scope` drops the workspace name and keeps the retention. With the chooser
directly above it, "{workspace} · 30 days" was the same fact twice in two
consecutive lines, which reads as two different ones.

### "Shared with me" excludes what I shared

`AND granted_by IS DISTINCT FROM $2` on both branches of `received`.

`IS DISTINCT FROM` rather than `<>`, because `granted_by` is `ON DELETE SET
NULL`: a grant outlives the account that made it, and a null compares to
nothing, so the plain comparison would have silently dropped every one of those
rows out of the list. There is a test for that specifically, and it is a
counterweight rather than a regression — the mistake it guards was available and
not made.

The question this list answers is "who gave me this, and who do I ask about it".
"You did" is the one answer nobody needs.

## Consequences

**Three route tests, one of them failing before the change.** The other two are
counterweights: somebody else's grant to the same group still arrives, with the
group named and the granter named; and a grant whose author is gone is still
listed. A fix that emptied "shared with me" would pass the first test alone.

**Two wiring assertions**, labelled as such. What they can see is that the two
per-workspace modes are given the chooser; what they cannot see is the rendered
head, which `Sidebar` has drawn from `panelChooser` since ADR-0070. The
behavioural weight of this round is on the route.

**The tenth backtick.** A comment written inside a SQL template literal ended
the literal and the build. The count is in `claude/rechte-und-zugriff.md`, and
it said nine.

## Alternatives considered

**Make the shares screen global**, listing every workspace at once. It matches
what somebody means by "what have I let out" — and the links list already
resolves page access per row in a loop, so going global multiplies that by the
number of workspaces, and the screen would then need to group by workspace,
which is the chooser again with more machinery. The per-workspace shape is also
the one ADR-0088 argued for: a share is a rule about pages, and pages belong to
one workspace.

**Put the workspace in the `/shares` URL** so the screen is bookmarkable per
workspace. Right, and a bigger change than this: `paths.ts` deliberately keeps
the workspace out of every path (ADR-0016), so this would be the first exception
and would need an answer for what happens when the remembered workspace and the
URL disagree.

**Leave `received` alone and label the row "by you".** Honest, and it leaves the
count wrong on a menu whose numbers are the reason it does not have to be
clicked. A page you shared is not a page shared with you, however it is
labelled.

**Filter the overlap in the client.** The row would still be counted by the
server, so the menu would say three and the list show two — the failure mode
ADR-0088 avoided by taking the counts from the list the screen already holds.
