# ADR-0096: A scope earns its keep

## Status

Accepted. Built. The second subject on the frame ADR-0093 added, and the reason
that frame carries a scope rather than being a bare nudge.

## Context

Two notes had been waiting for this, written eight weeks apart and by different
reasoning.

`usePages`, from the beginning: *"Changes made by other people still arrive on
the next refetch rather than live; that needs a workspace-level subscription,
which the sync protocol does not have yet."*

ADR-0095, three days ago: *"A role that changes while somebody is looking is
still noticed only on the next refetch."* That one is sharper than a
convenience. Since ADR-0095 an entry carries what it allows, so a permission
that arrives while somebody has the tree open leaves a rename field on their
screen that the server will refuse — which is the exact fault ADR-0095 existed
to remove, arriving a second later.

ADR-0093 gave the protocol `ServerMessage.Notify` with a scope string, and said
why: *"so the next thing worth nudging — the page tree — costs no protocol
version."* It cost none. `NotifyScope.Pages` is the whole protocol change.

## Decisions

### Addressed by workspace, because that is what a tree is

`SyncServer` gains a second index: connections by workspace, beside the
connections-by-person that ADR-0093 added. The pair is the point — an inbox
belongs to a person and a page tree belongs to a workspace, so a nudge about one
cannot be addressed the way a nudge about the other is.

A connection authenticates for exactly one workspace, so this is a plain map
rather than a question. Share-link visitors are in it and are not in the
person index: they have no account and therefore no inbox (ADR-0046), and they
do have a tree — the list of what the link reaches.

### Everybody with the workspace open, without asking who may see the change

The frame names nothing about the change, so there is nothing to filter. It says
which list to fetch again, and the tree route is the one place that decides what
each person gets back.

Filtering here would mean the sync server resolving a page's access per
connection — a second answer to a question that route already answers
(ADR-0086), and one that gets the two cases that matter wrong anyway: a deletion
has no page left to resolve, and a move changes who may see it in both
directions.

What that costs is a timing signal: somebody with the workspace open learns that
*something* in it changed. For a member that is already true of the tree they
then fetch. For a guest holding one shared page it is new, and it is a timestamp
and nothing else — the alternative is a per-connection access resolution on
every keystroke that survives the column filter below, which is a worse trade
than the signal.

### The column list is the design

The projection rewrites a page's row on **every flush** — every few hundred
milliseconds while somebody types — and `last_edited_at` changes each time. A
trigger on any update at all would turn one person's typing into a full tree
refetch for every other person in the workspace, several times a second. That is
a push worse than the polling it replaces.

So the update trigger compares, before and after, exactly the columns the tree
draws or resolves a role from: parent, collection, index, title, icon, kind,
template, locked, archived, restricted, ancestors, workspace.
`last_edited_at` is deliberately outside that list. It is on screen, and it is
not worth a request per keystroke; focus still catches it.

Statement-level over transition tables, as in 0063: an import writes a subtree in
one statement, and a nudge per row would be a full tree refetch per row for
everybody.

### The three tables a role comes from, too

`page_permissions`, `page_group_permissions` and `page_caps` change what an entry
allows without touching the page row at all. They are rare, so there is no noise
argument against them, and they are the case ADR-0095 named.

A page moved between workspaces (ADR-0038) rings **two** doorbells: the tree it
joined, and the tree it left, which would otherwise go on showing an entry that
has gone.

### The browser coalesces

One nudge is one reload of the whole tree. A rename is one nudge; an import or a
move is several statements and therefore several. So a nudge opens a 250ms
window and the reload happens at the end of it.

Long enough to swallow a burst from one action, short enough that a colleague's
rename appears while somebody is still looking at the place it happened. The
test that matters is not that the window closes a burst — it is that the window
*reopens*: a latch that never does looks exactly like a push that works, until
the second change.

### The focus refresh stays

Same reason as the bell's. A push says what happened while the connection was
up; nothing says what happened while it was not — a sleeping laptop, a discarded
tab, a deploy.

## Consequences

**Two indexes, two subjects, one frame.** The scope has now paid for itself
once, which is the evidence that it was not speculative generality. The next
subject — the trash, the shares screen — is a constant and a trigger.

> **Half right, and ADR-0097 fixed the other half.** The *protocol* was a
> constant. This record gave the page tree its own Postgres channel, so a third
> subject would also have needed a channel, a bus handler and its wiring —
> three copies of a shape differing only in a string. The channel now carries
> the string (`sone_workspace_changed` with `{workspaceId, scope}`), which is
> what makes the sentence above true rather than optimistic.

**`usePages` keeps its optimistic local rename.** The nudge costs a round trip,
and renaming the page in front of you should not wait for one. What changed is
that somebody *else's* rename no longer waits for a focus event.

**Nine route tests, seven failing before the change**, and the two that passed
are the two about silence — which is what "nothing is sent" looks like when
nothing is sent at all. The same shape as ADR-0093's file, and the same reason:
a test of absence cannot distinguish a working filter from a missing feature, so
it is the presence tests that carry the proof.

## Alternatives considered

**Carry the changed page id.** Would let a client patch one entry instead of
refetching a list, and it puts a restricted page's identity on a wire that
reaches everybody with the workspace open. It also cannot express a deletion or
a move without saying more, and the tree is small — one indexed query, which is
the payoff ADR-0002 was for.

**Filter per connection on the server.** See above: a second resolver, wrong for
deletes and moves.

**Notify on any change to `pages`.** One line shorter and it makes typing ring
the doorbell for everybody in the workspace, several times a second.

**Reuse the document bus.** It carries `{docId, seq}` and is consumed by rooms.
A tree is not a document and the people who need telling are not the people in
that document's room — the same wrong-index mistake ADR-0093 rejected for the
bell.

**Push the changed rows rather than a nudge.** Then the sync server decides what
each person may see, and the tree route and the push disagree the first time one
of them changes. The doorbell exists so there is one answer.
