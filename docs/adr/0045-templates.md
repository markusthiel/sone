# ADR-0045: Templates

## Status

Accepted.

## Context

Wanted for a while, and it keeps arriving under other names: "copy a page to
another workspace" was asked for once and the thing actually needed was a shape
to start from. Docmost shipped templates in July 2026; they are the cheapest of
the four gaps the September review named.

The question is not whether. It is what a template *is*, because there are two
answers and they lead to different applications.

## Decisions

### A template is an ordinary page with a flag

Not a separate kind (ADR-0019's kinds are about where a thing lives), not a
separate table, not a document in a special folder. A page, with `template` set.

Which means it is written with the same editor, permissioned by the same rules,
searched by the same index, moved and trashed the same way, and can be a canvas
as easily as a document. Every one of those would otherwise be a feature the
template screen had to grow of its own, and each would be a worse copy of what
pages already have.

The flag lives in the document as well as in a column, like the icon and the
width: it is a property of the page and it travels when the page does.

### It stays where its author put it

A template is a page in the tree, in whatever folder makes sense, not collected
into a hidden "Templates" area. Somebody who has organised their workspace has
already decided where the meeting-notes shape belongs, and moving it somewhere
else on our authority is worse than a list.

What it does *not* do is clutter: a template is offered where new pages are
started, so it is findable without being filed twice.

### Using one copies the document, not the text

The new page is created by copying the template's Yjs document and then replacing
the page's own properties — title, template flag, position. Not by extracting
Markdown and re-parsing it: a round trip through text loses collections, canvases,
table widths, colours and block attributes, which are exactly the things somebody
built a template for.

Consequences worth stating:

**Attribution comes with it, and that is correct.** The words in the copy really
were written by whoever wrote the template. Clearing the mapping would make a
page that somebody demonstrably authored appear authored by nobody.

**Attachments are shared by reference.** A picture in a template is the
workspace's file (ADR-0029), and the copy points at the same one rather than
duplicating bytes. That is right for storage and it has an edge: deleting the
template's picture leaves the copies pointing at a file that is gone. Acceptable,
because a file belongs to the workspace rather than to the page that uploaded it,
and the alternative is a copy of every image every time somebody starts a meeting
note.

### One page, not a subtree — for now

A template with children would have to copy a tree, which is a different
operation with its own failure modes (partial copies, ordering, permission
inheritance per child). The first version copies one page. If subtree templates
are wanted later they are a plan-and-execute job in ADR-0044's sense, and should
reuse that machinery rather than inventing a second one.

### Offered where a page is started, and nowhere else

The `+` on a folder already asks what to add (page, canvas, folder). Templates
join that menu under their own heading. No separate screen, no gallery, no
"template library" — a list of shapes is a list, and it belongs where the
decision is made.

A workspace with no templates shows no heading. A feature that advertises its own
emptiness teaches people to ignore that part of the menu.

### Marking one is a toggle in the entry's own menu

"Use as a template" in the ⋮ menu, beside the other things done to an entry. Not
a checkbox in a settings screen: whether this page is a shape to start from is a
fact about this page, and it is decided while looking at it.

## Consequences

Anything a page can be, a template can be — including a canvas, which was not
planned for and comes free.

A template is visible in the tree like any other page, so somebody will
eventually ask for them to be hidden. That is a preference, not a fix, and the
answer is a filter in the sidebar rather than a second home for them.

The copy is a snapshot. Changing the template later does not change pages made
from it, and it must not: a page somebody has filled in is theirs. Synced blocks
are the feature that does the other thing, and ADR-0043's review declined them
for reasons that still hold.

## Alternatives considered

**A `templates` table with its own editor.** Rejected: a second, worse editor,
and every page feature reimplemented for it.

**A reserved folder whose children are templates.** Rejected: it makes the
workspace's own organisation subordinate to ours, and it breaks the moment
somebody moves the folder.

**Copying by exporting to Markdown and importing.** Rejected: it loses exactly
the structure that makes a template worth having.
