# ADR-0032: Three settings areas, not one screen with three groups

## Status

Accepted and implemented, with two deviations recorded below. Supersedes the single-screen arrangement in ADR-0027; that ADR's
reasoning about *naming the subject* is kept and taken further.

## Context

ADR-0027 put everything configurable behind one screen with a list down the side,
grouped into "You", "Workspaces" and "Instance". The grouping was the right
insight — the group names say whose settings these are rather than who may change
them — and the arrangement has since run into three problems.

**Two entries in the account menu are the same place.** "Edit your profile" goes
to `/settings/account` and "Settings" goes to `/settings`, which defaults to
`account`. The menu offers a choice that is not one.

**Two sections fell out of the list and are unreachable.** `SECTIONS` no longer
contains `theme` or `groups`, and `Settings.tsx` still renders both. So a
workspace's typography — the per-workspace heading sizes and text scale — and its
groups cannot be opened at all. Nothing is broken in the code; a list had two
entries removed and the code below it stayed. That is the interesting part: a
flat list of ten heterogeneous entries is hard to keep honest, and it failed
silently rather than loudly.

**It will keep growing.** Single sign-on arrived after that list was written.
Everything an administrator will want next — audit, backups, rate limits, mail —
lands in the same list, beside "How SONE looks to you".

## Decisions

### Three areas, three routes, three navigations

- `/settings` — **you**. Your profile, your password, how SONE looks to you.
- `/workspace` — **this workspace**. What it is called, how it reads, who is in
  it.
- `/admin` — **the instance**. Only reachable, and only offered, with the right.

Each has its own list, its own default section and its own URL space.

### The boundary is whose it is, not who may change it

ADR-0027 named the subject in a heading; this makes the subject the boundary.
Applied, it settles the two cases that look like exceptions:

- **"Where you land"** is about a workspace, and it belongs to **you**: the value
  is one person's choice of where their own session opens. Two members of a
  workspace have different answers, so it cannot be a property of the workspace.
- **Typography** is about appearance, and it belongs to the **workspace**:
  everybody reading that workspace sees it, and it is stored on the workspace.

The rule is the same one ADR-0031 used for the switcher's order. When a new
setting's home is unclear, this is the question to ask, and the answer is not
"who is allowed to touch it".

### What goes where

Nothing new is built. Every panel already exists; this says where each opens.

**You** — Profile (name, address, picture), Password and sign-in, Appearance,
Where you land, About.

**This workspace** — Name, icon and colours; Typography; People and invitations;
Groups; Trash; Delete this workspace.

**The instance** — This instance (name, sign-up); Accounts; Invitations to the
instance; Single sign-on; All workspaces; Maintenance.

About sits with **you** rather than with the instance: the version and the
licence are what somebody looks up before filing a report, and requiring the
administration right to read a licence would be absurd. The version link at the
foot of the sidebar keeps pointing there.

"All workspaces" stays in **the instance** even though `/workspace` also
administers a workspace. They are different jobs: one is the workspace you are
in, the other is every workspace here including ones you are not a member of.

### Every member may open the workspace area

Read-only where they may not write, which is what the workspace panel already
does: the controls are disabled rather than the section being hidden, because a
form that lets somebody fill it in and then refuses is worse than one that says
up front it is read-only.

`/admin` is the exception and is absent rather than disabled, for the reason
ADR-0027 gives: a menu entry that answers "not found" teaches people to distrust
the menu.

### Old URLs are redirected, not broken

`/settings/<section>` links exist outside this code — in the sidebar, in the
workspace switcher, and in anything anybody has bookmarked. URLs are a public
contract (ADR-0016), so the old section ids map to their new homes for one
release rather than becoming a not-found page. The map is one table, and it goes
away in the release after.

### The way between areas is a switcher, in the position that already means that

Added after the areas were built and used. Getting from the instance's
administration to your own profile meant leaving the settings and coming back in,
which is a lot of clicks for something the three-area split makes a common move.

The control is the one at the top of a column — the shape the workspace switcher
is — and it holds the three areas. Same shape, same place, because that is where
somebody has already learnt to look for "where am I, and what else is there";
what differs is what the answer is about, and the button's own label says which.

The two are never one menu. "Which workspace" and "whose settings" are different
questions, and a menu holding both means two things — which is the mistake the
switcher already made once, with a "Manage workspaces" entry that was a second
place to do the same thing.

The CSS is therefore named `switcher-*` rather than `workspace-*`: the shape
belongs to the position, and naming it after one of the two things it holds would
leave the other looking like a borrowed style.

In the workspace area the switcher carries the workspace's own name as a quieter
second line. "This workspace" is true of five of them, and somebody with five has
to see which one they are editing before they change its typography. A second line
rather than a second switcher, because which workspace is being configured is a
fact on that screen and not a choice: choosing a different one is what the
administration list is for, and two identical dropdowns stacked on one of three
screens would be an exception to explain rather than a shape to learn.

### One shell, three areas

The list-and-section layout — including the two-view arrangement a phone gets —
is extracted once and used three times. Three areas must not mean three layouts
that drift apart; that is the same mistake as three ways of ordering a list.

### Deviations from this decision as first built

Written down rather than quietly skipped, because the list above is what the next
person will read as the plan. Two of the three have since been closed, and say so
here rather than in a commit message nobody will look for.

**Trash stays its own route.** It is listed above under the workspace, and it is
a place you go rather than a setting you change — it already has `/trash` and an
entry in the account menu, and moving it into a settings list would make it
harder to reach for no gain.

**Profile was one section, not two,** and is now two — "Profile" and "Signing
in". The deviation was that splitting the account panel is a change to that panel
rather than to the areas; it has since been made. Signing in is where single
sign-on and a second factor would go, which is the argument for it having a place
of its own rather than being the foot of somebody's name and picture.

**Member roles were still administered from All workspaces,** and are not any
more: the same table is used from both places, read-only for a member who may not
change it. The server had always allowed a workspace's own owners and
administrators — only the interface required the instance-wide right, because the
table lived inside the administration screen.

## Consequences

The two unreachable sections come back as part of this rather than as a separate
fix, and they come back somewhere they can be found: typography beside the
workspace's other appearance settings, groups beside its people.

Getting from a personal preference to an instance switch takes more clicks than
it does today. That is the point — they are different jobs, and the cost of the
current arrangement is that they are one keystroke apart in one list.

Three lists of five or six entries each will each grow, and each has room to grow
into sub-sections without the whole becoming a wall. The failure this fixes is
specifically the wall.

There is a risk worth naming: three routes means three places to forget a rights
check. The check stays where it already is — the server answers, and the
interface hides what the server would refuse — so this moves lists rather than
authorisation.

## Alternatives considered

**Keep one screen and repair the list.** Cheapest, and it fixes the two
unreachable sections in an afternoon. Rejected because it leaves the failure mode
in place: the list got into that state by being one flat list of everything, and
it will get there again. It also leaves both account-menu entries pointing at one
page, which is the report that started this.

**Tabs across the top of one screen.** Same list problem in a different shape,
and a tab strip that has to hold three unrelated hierarchies is a worse version
of the sidebar it replaces.

**Workspace settings inside the switcher popover.** Tempting, because that is
where somebody is when they think about a workspace. Rejected: a popover is for
choosing one of a few things, and a settings hierarchy inside one cannot be
linked to, scrolled comfortably, or read on a phone.

**A modal dialog for settings, as several editors do.** Rejected on ADR-0016: a
URL that can be sent is worth more than the illusion of not having left the
document, and "open Settings → Single sign-on" is a sentence a support answer
needs to be able to link.
