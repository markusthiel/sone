# ADR-0123: An instance has a look of its own

## Status

Accepted. Built. Asked for. Extends ADR-0023 (a workspace theme) and ADR-0122
(surface roles) with the layer underneath both. Adds a fourth holder of a
storage key to ADR-0109's list.

## Context

> Und dann noch Branding auf Instanz-Ebene. Dass man in der Verwaltung ein Logo
> festlegen kann, quadratisch, und ein Basis-Design das genutzt wird, wenn im
> Workspace nichts eingestellt ist.

Two things, and the second is the one with an argument in it.

A base design is not a new mechanism. ADR-0023 already says what a theme is:

> It fills gaps, it does not override.

This is that sentence applied one level up. What changes is that the layer
underneath a workspace is no longer the stylesheet alone.

**What existed, checked rather than assumed:** an instance had a *name*, shown
on the sign-in screen, and nothing else. Every colour on every instance was the
same colour. A workspace could theme itself, so an instance with one workspace
could look like somebody's own — and an instance with twelve had twelve chances
to and no way to say what they had in common.

## Decisions

### The brand travels on `/api/instance`

Both halves are visible **before anybody signs in**, and that is the point of
them: an instance's look that only appears once somebody is inside is branding
for people who already know where they are.

`/api/instance` is the one route that answers with nobody signed in. It already
carries the form of address for exactly this reason (ADR-0041), so the brand
goes there rather than on the session.

### A base design is a theme, checked by the rules every theme is

`brandTheme` goes through the same `sanitiseTheme` a workspace's does, so an
administrator cannot express anything a workspace could not. That matters more
here than there: this is the one everybody sees who has set nothing.

Two halves of the checking, answering different questions. **Inside** an object,
an unusable field is dropped — a theme arrives from a form, and one stale value
must not cost an instance the rest. But a value that is **not an object** is
rejected: `sanitiseTheme` would turn it into `{}`, which would quietly clear the
instance's whole appearance because a client had a bug.

### The merge is per named thing, and it happens in the browser

`mergeThemes` in `@sone/core`, so the answer is one function rather than one per
caller. The whole of the difficulty is one level down, in the settings that are
**maps**: a whole-value overwrite would mean a workspace that changed one
palette colour discarded every other colour the instance chose — invisibly,
because its own settings screen would go on showing seven unset names. Palettes,
surfaces and each element's four properties merge entry by entry.

**In the browser and not on the server**, because the settings form reads the
workspace's theme from the same route and has to show what the *workspace* set.
A form displaying the instance's accent as its own is a form where clearing a
setting appears to change nothing.

### The first two settings with no environment behind them

Every other instance setting falls back to a value the deployment supplied. A
theme is an object and a logo is bytes, and neither belongs in a compose file —
so these two resolve from a fixed empty default instead. Empty is what a fresh
instance has, and it renders exactly as every instance rendered before there was
branding.

That needed a fourth setting type, `json`, whose check belongs to the key rather
than to the type: a theme and a logo are both objects and share nothing else.

### The logo is the only file on this instance served to nobody in particular

An attachment is authorised through its page; a face through a session. The logo
is drawn on the sign-in screen, so requiring a session to see it would be
requiring a session to see the sign-in screen. It leaks that the instance has a
logo, which is visible from that screen regardless.

**No `files` row.** A logo belongs to no workspace and no page, so it is a key on
a setting, exactly as an avatar is a key on a person — and it is stored as one
value with its type beside it, because a key stored next to the wrong type is a
PNG served as a JPEG and the browser that refuses it is right.

**The address carries the key.** The bytes at a storage key never change — the
key is their hash — so the answer may be cached for a week and marked immutable.
That is only safe because a new logo is a new URL. The route itself does not read
the parameter; the setting says which key to serve.

**The bytes decide the type**, as everywhere else here: a browser sends
`image/png` for anything, and this file is served to everybody who reaches the
sign-in screen, including people who are not signed in at all.

### The orphan sweep learns a fourth place

ADR-0109's file names three columns that hold a storage key and says missing one
deletes live data. This is the fourth, and it is exactly the shape that file
warns about: a place added afterwards without the sweep knowing is a file that
disappears a week later. The logo would have vanished from the sign-in screen of
an instance nobody had touched.

### One form, two owners

`ThemeSettings` takes a load/save pair instead of a workspace id. A second copy
of the form for the instance would be the one where a control is forgotten — and
the forgotten control would be missing from the layer everybody sees who has set
nothing.

### The mark is a context, not a prop

`SoneMark` draws the instance's picture when there is one and its own drawing
otherwise. It is reached through a context because the mark appears in the rail,
in the mode bar on a phone, on the sign-in screen and beside a workspace in the
switcher: four props are four chances to show two different logos on one screen.

Null is the ordinary state **and** the state of an instance whose `/api/instance`
has not arrived yet. Both are correct, so nothing waits.

A near-square picture is fitted rather than stretched. Refusing a 1000×980 file
would be refusing somebody's logo over twenty pixels.

## Consequences

**Eight core tests, nine server tests, four web tests**, plus one added to the
orphan sweep for the fourth key holder.

**A blocked account still sees the mark.** `/api/instance/logo` joins the short
list of paths reachable while somebody is locked out for not enrolling a second
factor: the screen telling them to enrol is drawn with this instance's logo on
it, and refusing the picture would be refusing the branding of the page doing the
refusing.

**The mail shell can now embed a logo.** ADR-0121 left the wordmark as text
"until an instance has a logo of its own to inline", and named this as the step
it would hook into. It has not been done here — it needs `multipart/related` and
a `cid:` attachment, because a *remote* image in a mail reports when it was
opened, which this project does not measure.

**Light and dark are still per browser.** The three-level resolution asked for —
instance, workspace, person — is done for the theme's two levels and not for the
scheme, which still lives in `localStorage`. That is the next record: it needs a
column on the account and an answer to what the first paint shows before the
session has loaded.

## Alternatives considered

**Merge on the server and send one theme.** Fewer moving parts, and it breaks the
settings form: the workspace's own screen would show the instance's values as its
own, and "as designed" would stop meaning anything there.

**A whole-value overwrite instead of a per-name merge.** Simpler by a dozen lines
and wrong in the way that is hardest to see — a workspace that set one colour
would silently discard the instance's other seven, and nothing on either screen
would say so.

**Put the logo in the `files` table with a null page.** It would reuse the
serving route, and that route authorises through a page: a file with no page is
a special case in the middle of the check that decides who may read every
attachment on the instance. A separate route with no authorisation at all is
shorter and says what it means.

**Let an administrator set the logo's URL** instead of uploading. No storage, no
sweep entry, no upload route — and every reader of the sign-in screen reported to
somebody else's server, which is the same objection ADR-0121 makes to remote
images in mail.

**A per-person theme as a third layer.** Not asked for, and it is a whole
settings screen per account for a workspace decision. What a person actually
wants to override is light and dark, which is the next record.
