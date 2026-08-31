# ADR-0030: A workspace looks like something

## Status

Accepted and implemented.

## Context

A workspace has a name and nothing else. In the switcher they are a list of
words, and somebody who belongs to five reads all five every time to find one —
which is the thing an icon fixes and a name cannot.

Entries already have this: an icon from the Lucide set, a colour for the icon
and a separate one for the title, stored in `pages.icon` (ADR-0023 and after).
The question here is not what it should look like but whether a workspace's
appearance is the same kind of thing as an entry's.

## Decisions

### The same vocabulary as an entry

The same icon set, the same colour choice, the same split between the icon's
colour and the text's, and the same custom-colour escape hatch.

Not because reuse is tidy, but because somebody who has decorated a folder has
already learnt this; making a workspace's appearance a second, similar system
would mean learning it twice and being surprised by the differences. The
differences are what make two similar systems worse than one.

### On the workspace row, not in the theme

`workspaces` gains `icon jsonb`, holding the same shape `pages.icon` holds.

The workspace theme (ADR-0023) is about how *content* looks to everybody reading
it. This is about how the workspace itself is recognised in a list. Putting it in
the theme would mean a person's switcher changing because somebody adjusted the
heading colour, which are unrelated things that happen to both be "appearance".

### Anybody who may rename it may decorate it

Owners and administrators of the workspace, and holders of the instance-wide
right to manage workspaces (ADR-0027) — the same set that may rename it, because
a name and a mark are the same act of naming, and a permission that lets you
change one but not the other is a rule nobody can predict.

It follows that it is editable from the administration list, which is where
somebody managing a workspace they are not in does everything else.

### Editable later, and no worse for having no icon

A workspace with no icon shows its initial on a tinted square — what the account
does today when there is no picture. So the feature adds something rather than
making everything before it look unfinished, and nobody has to decorate anything
to have a usable switcher.

## Consequences

The switcher becomes a list of marks with names beside them, which is the point,
and the row can then be one line: the item count goes, because how many pages a
workspace holds is not how anybody recognises it.

The icon appears wherever a workspace is named — switcher, administration list,
the invitation somebody receives — so each of those has to read it rather than
print the name alone.

`pages.icon`'s readers (`readEntryIcon`, `readTitleColor`, `colorValue`) work on
a shape rather than on pages, so they are reused rather than copied. If they turn
out not to, that is a sign the shape was never shared and this decision needs
revisiting rather than working around.

## Alternatives considered

**A picture per workspace, like an account.** Rejected: an uploaded image at 22
pixels is a smudge, and the reason accounts have one is that faces are
recognisable at any size in a way logos are not.

**Colour only, no icon.** Simpler, and eight workspaces would exhaust the
palette while five icons are still distinguishable. Rejected on the count.

**Reusing the workspace theme's palette for the icon colour.** Tempting, and
rejected: the palette is per workspace, so an icon chosen from it would change
meaning between workspaces — the one place a colour must mean the same thing
everywhere is the list where they are compared.
