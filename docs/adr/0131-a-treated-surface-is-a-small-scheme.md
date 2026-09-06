# ADR-0131: A treated surface is a small scheme

## Status

Accepted. Built. Reported. Corrects ADR-0122, which described a property it
never emitted.

## Context

> Wenn ich die Seitenleiste auf umgekehrt stelle, sieht das super aus, aber beim
> Hover kann ich die icons und das logo nicht mehr sehen. Das selbe gilt für die
> Akzentfarbe. […] Und wenn man das ganze umdreht, funktioniert es auch wieder
> nicht. Wenn die Seite auf dunkel gesetzt wird und die Seitenleiste dann
> invertiert hell ist.

All three are one bug, and it is mine. ADR-0122 says, in its own consequences:

> **Hover inside a treated surface follows it**, which needed a fifth property
> per treatment. Without it an inverted rail kept the light theme's hover colour
> and handed it the light theme's text: white on near-white, on hover only.

The stylesheet was written to read `--sone-theme-<surface>-hover`. The table
that resolves a treatment has four entries and never had a fifth. So every
treated surface fell back to the **page's** hover: a light box under a light
icon in the light theme, and a dark box under a dark icon when the page is dark
and the surface is inverted — which is exactly the second half of the report.

**Neither test could see it.** The core's test listed the same four the code
did; the web's test listed the same four again. Two lists agreeing with each
other is not a check.

## Decisions

### A treatment is a small scheme, not a colour and a text colour

Eight parts now: `bg`, `ink`, `muted`, `border`, `hover`, `accent`,
`accent-ink`, `accent-quiet`. The rule underneath them has not changed — every
one is a `var(...)`, so one stored `inverted` still means opposite things to the
two readers — but the set is what a surface actually needs to draw everything
inside it.

The three that were missing all fail the same way. A surface that does not carry
its own **accent** is one where the mark's third bar and every filled button
belong to the page behind it; a surface without its own **quiet accent** is one
where an avatar's initials sit on the page's pale green. Both are inside the
rail today.

### On an accent surface the pair trades places

`--accent` becomes `--accent-contrast` and the other way round. Accent on accent
is nothing at all — a logo that vanishes and a button that is a rectangle of
ground — and swapping gives the same two colours the other way round, which is
readable by construction because the contrast colour was computed to be.

### On an inverted surface the accent is the other scheme's

`--accent-500` on near-black is the same too-dark green the dark theme already
replaces with `--accent-300`. An inverted surface is the other scheme's ground
standing in this one, so it takes that scheme's accent with it.

### The test compares the two halves rather than restating one

The core's test reads the parts **off what is emitted** and asserts the set; the
web's test takes the emitted names and requires the stylesheet to read each one.
A part added on either side alone now fails on the other.

That is the check this bug needed: the two halves live in different packages,
and the only honest test is the one that crosses between them.

## Consequences

**Two core tests rewritten, two web tests added.** No new mechanism — the
containers already redefined the names their contents read; there were simply
three fewer names than there are things to draw.

**An inverted rail now behaves in both directions.** Light page with a dark
rail, and dark page with a light rail, are the same code path with the tokens
swapped, which is what `inverted` was supposed to mean from the start.

**A workspace's colour code is the feature this protects.** It is the thing
Markus called the strongest of them, and a feature nobody can point at without
losing the icon is not one.

## Alternatives considered

**Give the treated rules explicit fallbacks instead.** `background:
var(--sone-theme-rail-hover, var(--surface-hover))` at each of the several dozen
rules inside those areas. It is the version ADR-0122 rejected and the reason it
rejected it stands: the one rule somebody forgets is a row nobody can read.

**Drop `--accent` inside a treated surface and give the mark its own token.**
Narrower and it fixes the logo — and leaves a filled button on an accent-coloured
panel invisible, which is the same bug one element along.

**Leave the accent alone and only fix hover.** What was reported was hover; what
was wrong was the set. Fixing the reported half would have left two more of the
same to find by looking at them.
