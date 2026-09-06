# ADR-0125: A theme as a file

## Status

Accepted. Built. Asked for. The last step of the appearance concept that began
with ADR-0120; it adds no new thing a theme can say and no new way to store one.

## Context

> Ggf. auch Themes die man importieren und exportieren kann, die dann wirklich
> alles verändern.

The second half of that sentence is the one that took four records to earn. When
it was asked, a theme was a tint, an accent, a palette and per-element type — so
a file of one would have changed colours, which was the complaint in the same
message:

> dass dann halt alle Farben anders sind, aber sonst verändert sich nichts.

A theme now carries the surfaces and the corners (ADR-0122) and light-or-dark
(ADR-0124), and it has a second owner underneath every workspace (ADR-0123). A
file of one really does change what a place looks like, and there are two places
to load one into.

## Decisions

### It is not a second way into a theme

What comes out of a file goes through the same `sanitiseTheme` the form and the
server run. **An imported file can do nothing the form could not** — which is
what makes it safe to accept one somebody downloaded from a stranger: there is
nothing expressible in it that a workspace could not already type in.

That is also why there is **no route**. The browser reads the file and puts it in
the form; saving is the PUT that already existed. A second endpoint would be a
second place a theme is validated.

### And it refuses what it does not recognise

The rule everywhere else in this area is the opposite — drop the unusable field,
keep the rest — and it is right there, because the input is a form somebody is
filling in and one stale value must not cost them their settings.

Here the input is a file somebody **picked**, and picking the wrong one is the
ordinary mistake. `sanitiseTheme` would turn a holiday photo's metadata into `{}`
and loading that would silently empty a workspace's whole appearance, showing a
form that looked reset with no reason why. So the file says what it is —
`"sone": "theme"` — and anything without that is refused, whole.

The marker rather than the shape, because a theme is almost entirely optional
fields: "looks like a theme" matches nearly any object, `{}` included.

Inside a file that *is* a theme, the ordinary rule returns and the contents are
filtered.

### The version is written and not read

`version: 1` is in the file. It is not branched on, deliberately: the sanitiser
already drops what it does not know, so a later release adding a field costs an
older one nothing — refusing on a number would turn a compatible file into an
error message for no gain. It is there so that a *breaking* rename one day has
something to look at.

### Loading fills in the form; nothing is stored

An import that wrote straight to the server would be a second path to saving a
theme, and one somebody could not walk away from. It ends in the same Save button
as every other change on the screen, and the form says which file its values came
from until it is saved.

**It replaces the whole theme, including the half the screen is not showing.** It
is one theme; a file that changed only the visible half would mean something
different depending on which of the two settings tabs was open.

### Exporting takes what is on the form

Unsaved changes included. Exporting the stored version instead would be a button
that quietly ignores what somebody is looking at, and the file they send on would
be the wrong one.

### The controls sit under both halves

Not on a screen of their own, and not on one of the two. A file is the *whole*
theme, so putting the control on the colour screen alone would suggest it carried
only colours — which is exactly the misunderstanding this whole sequence of
records has been correcting.

## Consequences

**Nine core tests and four web ones.** The web ones are mounted rather than read:
both claims are about what is on the screen and what did **not** reach the
server, and a source test could show neither.

**Two places to import into**, because ADR-0123 gave a theme a second owner. The
same form, the same file, the same two buttons — the instance's base design and a
workspace's are interchangeable documents.

**A theme file names itself after its owner**, and the name is metadata about the
file rather than a field on the theme. Storing it would be a label that stops
being true the moment somebody changes a colour.

**The concept's appearance half is finished.** What is left in it is the mail
side: sharing pages and guest links, the export link, the logo inlined into the
mail shell — plus two named gaps, the curated font pairs and the contrast check
as a computed test.

## Alternatives considered

**A route that takes the file.** The server would parse and store in one step,
and there would be nothing to press Save on: an import you cannot see before it
happens, on the setting that changes what everybody in a workspace looks at.

**Sanitise anything and load it.** No marker, no refusal, fewer lines. Picking
the wrong file then silently resets a workspace's appearance, and the person
cannot tell that is what happened.

**Refuse an unknown version.** Safe-looking, and it makes every older instance
reject files a newer one wrote for no reason the sanitiser does not already
handle.

**Store the file's name on the theme.** It would let a screen say "based on
Haus Thiel dark" — until the first colour is changed, after which it says
something false.

**A theme gallery on the instance.** Named themes, stored server-side, applied by
choosing. It is a real feature and a much larger one; a file is what makes a
theme portable between instances, which is what was asked for.
