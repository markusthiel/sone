# ADR-0088: Sharing you can enumerate

## Status

Accepted. Built.

## Context

Two things came from the same message, and they turn out to be one thing.

Markus asked for a menu item:

> Wir brauchen sicher noch einen Menüpunkt mit freigaben. So dass man sieht
> welche Seiten man selbst freigegeben hat und welche für mich freigegeben
> wurden. Als Übersicht und Möglichkeit zu bearbeiten.

And, later, reported this:

> wenn ich einen ganzen Ordner mit einem Gast teile kann er nur den Ordner
> sehen und sonst nichts. Nichts was darunter liegt. Er braucht im Grunde auch
> einen Seitenbaum mit allen Seiten die vererbt sind.

The second was investigated first, because a bug outranks a feature. The
permission model turned out to be innocent: a share link's grant carries the
subtree, and both resolvers honour it — a member with a subtree grant on a
folder reaches everything under it, and so does a link. The tree route returns
the children. All of that was verified against a real database before anything
was changed.

The fault was one layer up. **The shared-link view renders exactly one page and
has no navigation at all.** So sharing a folder shares an empty page with a name
at the top, because a folder has no body. The grant was correct and unreachable.

Which is the same failure as the missing menu item, at a different scale: SONE
could *decide* about sharing perfectly and could not *show* it. From the page,
one dialog answers "who can see this". Nowhere answers "what is shared", and
nowhere answers "what does this link actually open".

**A rule nobody can enumerate is a rule nobody reviews.** That is the sentence
this record is about, and it is why one ADR covers both.

## Decisions

### A link answers what it reaches

`GET /api/share/:token/pages` returns the page the link names and, when the link
says so, its subtree. The link view draws them as an indented list beside the
page, and draws nothing when the list has one entry — a link to a single page has
nothing to navigate, and an aside holding one item is furniture.

**Walked down from the grant, never filtered out of the workspace.** The scope
query starts at the page the link names and takes its descendants. The
alternative — list the workspace and remove what the link does not reach — is one
forgotten condition away from naming a page the visitor was never given. A list
that starts from the grant cannot make that mistake; a list that starts from
everything can only avoid it by being right every time.

Every row still goes through `effectiveRole` rather than being trusted because
the link's grant covers it. A cap lowers a link like anybody else (ADR-0087), and
a page's own rules apply underneath a shared section. The link's grant is an
input to the decision, not the decision.

### Three lists, and they are not interchangeable

`GET /api/workspaces/:id/shares` answers with **links**, **granted** and
**received**, in that order.

Links first, because a link is the only kind of share that has already left the
building: it is a URL in somebody's inbox, forwardable by somebody who was never
given anything. The other two are people who are already here.

Then what this person gave, then what they were given — a responsibility before a
courtesy.

### What each list is scoped to, and why they differ

**`granted` is `granted_by = me`**, not "every grant on a page I administer". The
narrower rule is the honest one for a list called "shared by me": a grant
somebody else made is not this person's to review, and showing it would turn the
screen into a directory of who has access to what, which is the disclosure
ADR-0026 spends its length avoiding. An administrator loses nothing — they can
open any page and see its full list — except other people's decisions presented
as their own.

**`links` is every live link on a page they may manage**, which is wider, and the
difference is deliberate. A link is not a decision about a person, it is a
capability loose in the world; whoever is responsible for the page has to be able
to see one they did not make, or the list is a list of the links you already
remembered. Each row is checked with `resolvePageAccess` per link rather than by
reproducing the rule as a SQL condition — the mistake ADR-0086 was written about.

### The overview can undo, and cannot re-grade

Revoking a link is offered in the list. Changing a level is not.

Changing what somebody may do is a decision about one page, made with that page
in front of you; a second screen offering it is a second place to set
permissions, and two places is how two answers come about. The row links to the
page instead.

A grant row carries names rather than ids — a group and a person can share one —
so withdrawing from this screen could undo the wrong subject. It links to the
page's own dialog, which has the ids and the context.

## Consequences

Sharing a folder now works the way somebody sending the link expects, which is
the first time that has been true.

The overview is per workspace, unlike the inbox, which spans them: a share is a
rule about pages, and pages belong to one workspace.

**A finding this turned up, and did not act on.** A grant on an ancestor with
`include_subtree` reaches a *restricted* page below it. Restriction withholds the
workspace default; an explicit grant reaches through it (ADR-0026), and a subtree
grant is an explicit grant. Both resolvers agree, so it is the model speaking
rather than a hole — but "only the people added below" reads like a fence, and a
grant one level up walks through it. Changing it would change what every existing
subtree grant does, so it is recorded here and in a test that says what actually
happens, for a decision of its own.

**And one the tree route still has.** `path_only` is computed for a page somebody
reaches only as the path to a child they were granted, exactly as ADR-0026
requires — and the very next line filters those rows out, because their
`effectiveRole` is null. The column is computed, documented, and discarded;
`PageSummary` has no field for it and types `title` as non-null. The client
compensates by treating an orphan as a root, which is why nobody noticed. Named
here rather than fixed, because it is a change to what the sidebar shows and
belongs with a decision about how a granted subpage should appear.

## Alternatives considered

**Give the link view the whole workspace tree, filtered.** Rejected above: a
filter that starts from everything is one forgotten condition away from a
disclosure, and the visitor is not a member.

**One list with a "direction" column.** Fewer headings, and it merges three
questions that get asked separately and acted on differently. The order of the
three is itself the advice.

**Put the overview in the workspace's settings.** It is about a workspace, so it
would fit. Rejected: "what have I let out" is a question about your own doing,
asked across every page you touched, and it belongs beside the trash and the
inbox — the other places where you look at your own traces (ADR-0070).
