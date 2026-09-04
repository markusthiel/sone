# ADR-0070: A menu answers for one subject

## Status

Accepted. Amends ADR-0069, which said the settings are three groups in one
list; they are two, and the third is a mode with a chooser.

## Context

ADR-0069 turned three settings screens into three groups in one panel: your
settings, the workspace you were in, the instance. It read as an improvement —
one list instead of a switcher you had to open to discover the other two areas —
and it was reported as one that had not worked.

The report is worth quoting, because it is the whole argument: *"Wieso soll ich
im Workspace einen SMTP einrichten? Kann ich da jetzt gesonderte SMTP Server
einsetzen pro Workspace? Ich glaube nicht."* Three rows under a workspace's name
came **Diese Instanz**, **Konten**, **Mailserver**, **Single Sign-on**. Nothing
in the layout said the scope had changed; the reader has to already know that a
mail server is not a workspace's business in order to read the menu correctly,
which is backwards.

The mistake is visible once the three are counted rather than listed. You have
one self. An instance has one server. A person has *several* workspaces — four,
in the instance this was reported from — and the list named exactly one of them,
whichever the address happened to carry. So two of the groups were headings over
a subject that could not be anything else, and the third was a heading over one
of several with no way to say which.

Reaching a workspace's settings made this concrete: the Workspaces mode listed
the workspaces, and clicking one *left that mode* for the settings mode, where
the workspace was one group among three. The mode whose subject is a workspace
handed its subject to a mode whose subject is not.

## Decision

**A menu answers for one subject, and a subject you have to choose gets a
chooser.**

The settings mode is you and the server: two groups, both with exactly one
subject each, and the scope line under the title says `Persönlich · Instanz`
because that is now true.

A workspace's settings are the Workspaces mode. Its column is the same shape as
the tree's: the head says which workspace — with the workspace switcher, the
same component the tree's head carries — and the body navigates that workspace's
sections. Above them, one row for the list of every workspace, which is what the
content area shows when no section is open.

**Choosing is one act.** Picking a workspace in the chooser switches into it, so
the mark takes you to that workspace's pages afterwards. Configuring a workspace
you are not standing in is how somebody renames the wrong one and does not
notice; and having a separate "switch" and "configure" would be two gestures for
one intention.

Where choosing lands depends on where you already were. On a section, the same
section under the new workspace: the question did not change, only what it is
being asked about. On the list, the list — nothing there is about one workspace,
so there is nothing to carry over, and no history entry is pushed for an address
that did not change.

## Consequences

The switcher is drawn in two places from one component. It can be, because
ADR-0069 had already reduced it to one question: a menu that also offered
"settings for this one" and "all workspaces" would have been wrong in one of the
two places.

`modeOf` maps `workspaceSettings` to the Workspaces mode rather than to
Settings, which is the whole structural change; everything else follows from it.
The chooser sits in the panel's **head**, not at the top of its body, because
the body scrolls and a menu dropping out of a scrolling box is clipped at its
edge — the same fault reported the same day for the account menu in the rail.

Two things were cleaned up on the way. `canManageWorkspaces` and
`isInstanceAdmin` were still being threaded through the shell into the switcher
to decide whether to offer an administration entry that had already been
deleted. And the switcher's rows fell back to the English word "Untitled" for a
workspace with no name — two English words in a German menu, on the one row with
no name to read instead.

What this does not settle is whether a workspace's *sections* are right. They
are the ones ADR-0067 gathered, unchanged, and this record only moves the menu
that lists them.
