# ADR-0124: Where light and dark are decided

## Status

Accepted. Built. Asked for. Completes the resolution ADR-0123 built two thirds
of. Amends the "stored per browser, not per account" rule in `useAppearance.ts`
for one of the three things it governed, and leaves it standing for the other
two.

## Context

> Und hell/dunkel als Standard, überschreibbar pro Workspace und pro Nutzer.

The middle level arrived with ADR-0123, because a theme already layers instance
under workspace. The top one did not exist at all: a person's answer lived in
`localStorage`, so somebody who chose dark on their laptop signed in on their
phone and got light.

The rule that put it there is right about the things beside it, and says so:

> Stored per browser, not per account. A text size is a property of the screen
> being read — a scale that suits a phone is wrong on a 27-inch monitor, and
> syncing it would make one device's setting the other's problem.

That argument holds for the two text scales and does not transfer. A preference
for dark is a property of the person; the property of the *device* is what
`system` already delegates to.

## Decisions

### Four states, and only three of them are values

    NULL / absent   whatever the level above says
    'system'        this device decides
    'light' / 'dark'

`system` is **not** the absence of a choice. It is the choice to let the device
decide, and somebody who makes it is overriding a workspace that says dark.
Collapsing the two costs exactly the case the request was about: a dark
workspace, and somebody in it who wants their laptop's own setting to rule.
With three states they could only pick light or dark by hand — and would then be
wrong twice a day, which is what `system` exists to avoid.

The same distinction `workspace_landing.mode` grew in ADR-0119, for the same
reason.

### The workspace's answer lives in the theme

`scheme` is a field on `WorkspaceTheme`, so an instance's default and a
workspace's override are **one merge and not a second mechanism** — the layering
ADR-0123 built already does it. It emits no custom property: a scheme is an
attribute on the root element and a whole second set of tokens, not a value.

### The person's answer is a column, resolved in one place

`users.color_scheme`, nullable, with a CHECK. `resolveScheme` in `@sone/core` is
the only thing that decides — one function because there are two callers who
must not disagree: the hook that applies it, and the line that paints the
remembered answer before the application has loaded.

An unusable stored value counts as nobody having said. Both arguments come out
of storage, and an account holding a word from a future release should get the
ordinary answer rather than an interface that cannot decide what colour it is.

### One writer of `data-theme`

Both the theme and the scheme are now resolved **above every branch of the
router**, next to each other. Applying the instance's answer at the top and
refining it inside the workspace would be two writers of one attribute, which is
a screen that changes colour a moment after it appears.

That move also fixed something quietly wrong: `useAppearance` was called *only*
by the appearance settings screen, so a signed-out sign-in screen never carried
an instance's colours at all — the ADR-0123 branding was invisible on the one
screen it was most for.

### `localStorage` becomes a cache of the answer, not the answer

The first paint happens before the session has loaded, and a dark-theme reader
must not be shown a white screen for the half-second it takes to find out. So
the resolved scheme is written back to storage and read at boot — **a copy of
last time's answer**, never a preference. It is read only when there is no
resolved answer yet and overwritten as soon as there is.

Wrong only for the moment after somebody changes the setting on another device,
and then only until the session arrives. A default would be wrong far more often.

The two text scales stay exactly where they were, for the reason quoted above.

### A bug this round found: the language could never be cleared

Every field on `PATCH /api/auth/profile` is `coalesce($n, column)`, where absent
and null are the same request. That is right for a field that cannot be unset
and wrong for one that can — and the appearance screen has always sent
`locale: null` for "match my browser", which the old value survived. Somebody who
once chose German could never get back to following their browser, though
ADR-0041 is explicit that absence is meaningful there:

> somebody travelling between a German and an English machine keeps getting each
> one's own

Both nullable fields now use a sentinel: `''` is not a value either column may
hold — the locale has a format CHECK and the scheme has a list — so "leave it
alone" has a representation that cannot collide with a real one.

## Consequences

**Six core tests, seven server tests, two web tests**, and one existing web test
updated.

**No backfill, and none possible.** Every account starts at NULL, which resolves
to `system` where nothing else has said — exactly what everybody has today. What
people chose in their browsers is in `localStorage` on their own machines and
this migration cannot see it; the cache is what keeps the change invisible to
them until they choose again.

**A workspace can now decide something a reader may not want.** That is the
point, and the escape is one control on the person's own settings screen —
`system` included, so "let my laptop decide" stays sayable inside a dark
workspace.

**Changing it reloads the session** rather than applying locally. The resolution
needs the workspace's theme and the instance's under it, and a second answer
computed on the settings screen is how two parts of an interface end up
disagreeing about what colour it is.

**Still open from the concept:** the theme export and import, sharing by mail,
the curated font pairs, the logo inlined into the mail shell, and the contrast
check as a computed test.

## Alternatives considered

**Three states, with `system` meaning "not set".** One fewer thing to explain,
and it removes the only way to say "my device decides" inside a workspace that
has an opinion — the case the request named.

**Keep it in `localStorage` and add the two levels above it.** Nothing to
migrate, and the phone still gets light. The complaint was about signing in
somewhere else.

**A column for the workspace's scheme, beside the theme.** A second place a
workspace's appearance lives, and a second merge to write. It is one more thing
a theme says, so it goes where a theme says things — which also means it travels
in an exported theme for free (the next step).

**Resolve on the server and send one word.** The server would have to know which
workspace the browser is currently in on a route that answers before there is
one, and the client would still need the theme for everything else. The
resolution is four lines; the coordination would not be.

**Block the first paint until the session arrives.** No stale colour ever, and a
white or blank screen for as long as the network takes — which is the thing the
pre-mount apply exists to prevent.
