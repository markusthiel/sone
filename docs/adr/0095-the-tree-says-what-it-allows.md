# ADR-0095: The tree says what it allows

## Status

Accepted. Built. The last of the three things ADR-0092 named and deliberately
did not do.

## Context

Recorded there, beside the folder-rendered-as-a-page fix:

> **Related, and deliberately not fixed here.** A **member** with viewer rights
> on a folder gets the same input and the same three buttons in the workspace,
> because the page tree carries no per-entry role for the shell to ask. Giving
> it one is a route change and a wider decision than this report.

It is a route change. It is not a wider decision, and the estimate was wrong in
an instructive direction: **the route was already computing the answer.**

`GET /api/workspaces/:workspaceId/pages` calls `effectiveRole` for every row —
that is the filter deciding which rows are sent at all — compares it with null,
and throws it away. Then it sends a list of entries that all look alike. So the
shell had nothing to ask, drew a rename field and three create buttons on a
folder somebody may only read, and the server answered 403 to each of them.

The same line, in the same shape, sits in the share route. Both fixed here.

That is now the third time in this codebase a value has been computed, used for
a decision, and dropped before anybody could see it — after `path_only`
(ADR-0088) and the mention's author (ADR-0091). It is worth naming as a smell in
its own right: **a filter is a computation somebody will want the answer to.**

## What was and was not wrong

**The server was right throughout.** Every write route already refuses a viewer:
`POST /api/workspaces/:id/pages` resolves the parent's role and rejects `viewer`
and `commenter`, `PATCH /api/pages/:id` does the same, the sharing routes are
guarded by `requirePageAdmin`. Nothing here closes a hole; there was none.

What it fixes is that **a control which is always refused is a lie, not a
safeguard.** Somebody clicking rename on a folder they may only read learns
nothing except that the application is unreliable — and the one thing they
needed to know, that this folder is not theirs to change, was the thing the
screen was hiding.

## Decisions

### The role travels on every entry, including as null

`role: Role | null` on each entry of the tree, and on each entry of a share
link's tree. Null only for a page kept as a path to a granted child (ADR-0026),
where "no role" is the honest answer: they may do nothing at all with the row
itself.

Sent for **every** entry rather than only where it is interesting. A field that
is usually present is a field every caller handles twice, and the shell would
then have to decide what an absent one means — which is the question this is
supposed to answer.

### Two questions, not one per verb

`mayEdit` and `mayManage`, in one module, read by every control.

One question for all the verbs — rename, move, delete, import, lock, icon,
"new inside this" — because the **server** asks one: every write route on a page
refuses `viewer` and `commenter` and accepts the rest. Splitting it in the
interface would invent distinctions the server does not make, and an invented
distinction is a promise the interface cannot keep.

The second question is genuinely different: sharing is guarded by
`requirePageAdmin`, so an editor may write a page and may not hand it to
somebody else. That is the one place "can change it" and "can pass it on"
diverge, and it earns its own function rather than a boolean argument.

**This is not a second place where rights are decided.** ADR-0026 is right that
a second decision is how two answers come about. These are two *readings* of the
one answer the server sends, and every write is still refused by the route that
receives it.

### What a viewer keeps

The gate is not "hide the menu". Taking away what somebody is entitled to would
be a second bug wearing the first one's clothes.

| kept | gated |
|---|---|
| the link, title, icon, twisty | rename, reorder, "new inside", icon and colours |
| starring (personal) | move, move to another workspace, import |
| watching (a subscription) | lock, delete |
| exporting (a read) | sharing — and that one on `mayManage` |

The reorderings are **hidden** rather than disabled, because `disabled` there
already means "you are at the end of the list" — a fact about position. Using
one appearance for two questions is how a control stops answering either.

### The import item, reversed on purpose

It carried a note saying it was offered unconditionally: *"this menu has no
notion of rights and I was about to invent one for a single entry; one item
guarded differently from its neighbours would be a lie about the other four."*

That was the right call then and is the wrong one now. The menu has a notion of
rights, given to it rather than invented, and all five neighbours ask it.
Writing into somebody else's folder is a write. The note is replaced by this
reasoning rather than deleted, because the earlier judgement was sound and it is
the premise that changed.

## Consequences

**A member with read-only access to a folder now sees a folder they can read.**
No caret in its name, no three buttons, no drag, no rename in the ⋮ — and its
contents, its icon, its star and its export, all of which were always theirs.

**The share tree carries a role too**, which nothing consumes yet beyond
satisfying the type. Sent anyway: a link that grants `commenter` and one that
grants `viewer` produced identical trees, and the guest view is the surface that
has twice now been given an affordance it should not have had (ADR-0092,
ADR-0090).

**`usePages` still refetches to notice somebody else's change**, and its comment
still says a workspace-level subscription "does not exist yet". It does now
(ADR-0093, `ServerMessage.Notify` with a scope). A role that changes while
somebody is looking is still noticed only on the next refetch. Named, not built:
it is the same shape of work as the bell and deserves its own decision.

**Six route tests, all six failing before the change**, and the interesting one
is the counterweight: a member keeps `editor` on the folder *beside* the
restricted one. A fix to this that read as "members see less" would be worse
than the bug.

## Alternatives considered

**A `canEdit` boolean on each entry instead of the role.** Smaller wire, and it
answers exactly one question — so sharing would have needed a second boolean,
and the next distinction a third. The role is what the server computed; sending
a derived summary of it means deciding, on the server, which questions the
interface is allowed to ask.

**Ask the server per entry when a menu opens.** A request per ⋯ click, to learn
something the tree route already knew. It also cannot help the rename field or
the drag gesture, which are not behind a menu.

**Gate the folder view only, as reported.** Would have left the ⋮ on the same
folder offering Rename and Delete — the same rule holding in one place and not
the one beside it, which this codebase has now recorded six times.

**Disable the controls rather than hide them, so people can see what they are
missing.** Tempting, and it is what `canMoveUp` does for a real reason. Applied
to rights it would put a row of grey verbs on every entry somebody was given to
read, which is a worse answer to "whose is this" than the absence.
