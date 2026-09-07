# ADR-0149: A mark for the ground it sits on

## Status

Accepted. Built.

## Context

> Für das Logo unter Verwaltung habe ich bisher nur eine Möglichkeit ein
> quadratisches Logo hoch zu laden. Wäre es machbar, dass man da ein dunkles und
> ein helles Logo platzieren kann, je nachdem wie hell die schmale Leiste ist?
> Und das System sollte dann selbst erkennen welches Logo am besten dort sitzt?
> Ich habe jetzt mehrere Workspaces mit Farben in der schmalen Leiste. bei
> einigen macht das Helle Logo mehr Sinn bei anderen das dunkle.

An instance uploads one mark (ADR-0123), and the interface draws it in the rail,
in the mode bar, on the sign-in screen and beside a workspace in the switcher.
Every one of those is a surface a workspace may treat: `raised`, `sunken`,
`inverted`, `accent` (ADR-0122). So a mark inked for white paper is correct in
one workspace and unreadable in the next, on the same instance, in the same
theme.

## Decisions

### Two marks, named by the ground and not by the ink

`brandLogo` and `brandLogoOnDark`. "Das helle Logo" means both *the light-looking
one* and *the one for light surfaces* — in both languages — so nothing in the
route, the settings key, the payload or the screen is named after the ink.

Two settings rather than one value holding both: they are uploaded, replaced and
removed one at a time, and a single value would make removing one a
read-modify-write of the other.

### The surface decides, and it is measured

Not read off `data-theme`. The theme cannot answer this: a treatment compiles to
`var(--accent)`, which is a colour only after the browser has resolved a custom
property that may be a hex somebody typed into a colour input. **The one place
that knows what colour is behind the mark is the mark.**

So `useGroundTone` walks up from the element to the first thing that paints,
reads its computed background, and asks `groundTone` — which is ADR-0136's own
comparison, `luminance(ground) > luminance('#808080')`, lifted out of
`readableInk` and given a name rather than copied into the web package.

### One mark uploaded is the mark everywhere

The state every instance is in today, and the one it stays in for anybody who
does not want two. Losing a logo because a workspace changed a colour would be a
worse answer than an imperfect contrast.

### The preview stands on the ground it is for

Each upload row draws its mark on white and on near-black respectively, in fixed
colours rather than tokens: those two stand for *any* light and *any* dark
surface a workspace might make, not for this theme's. A preview on the page's own
chrome — what the single row did — cannot show the thing being judged.

## Consequences

**Fifteen tests, eleven red first**, across three packages: the rule in `core`,
the choice on a mounted mark, and the two variants over the route.

**Measuring in a browser found a bug no test could have.** The first parser read
`rgb(16, 16, 16)` and took any three numbers as channels out of 255. Chrome
computes a `color-mix` surface — which is *every* surface here (ADR-0135) — as
`color(srgb 0.980392 0.972549 0.956863)`. Those are the same channels on a scale
of one, so **the near-white rail every instance has by default was read as
near-black**, and the ordinary case would have been given the wrong mark. The
scale now comes from the function name; a heuristic on the size of the numbers
gets `rgb(1, 1, 1)` exactly backwards. The strings Chrome returned are in the
test.

**A stale answer, caught by the tests.** The first hook measured once, with
`[ref]`. Nothing about a ground is a prop — no dependency list describes it — so
a mark that stays mounted while the surface under it is replaced kept its first
answer. It measures after every render now and bails out when nothing moved.

**The compatibility path was an alias nothing called.** The first version kept
`PUT /api/admin/brand/logo` as the light one, arguing that instances already use
it. `check-routes-reachable` refused that in CI, and it was right: once the
interface names both marks, nothing calls the unnamed path, and a route reachable
only with curl is what that check exists to find. The compatibility that matters
is the setting — an instance that uploaded a mark keeps it, because `brandLogo`
is still where the light one lives, and the test says that in terms of the
setting rather than of a URL.

**A callback ref, for ADR-0142's reason.** The caller attaches it to an `<img>`
in one branch and an `<svg>` in the other, and no single `RefObject<T>` fits
both.

**The orphan sweep learned the fifth place a storage key lives.** Its own comment
warned about exactly this: a holder it has not been told about is a file it
deletes a week after somebody uploaded it. The clause is a set now, so a third
mark is one word rather than another silent deletion.

**And that test only bites because of a seed.** It first passed against a sweep
that knew nothing — the fixture wrote a key with a `g` in it, and the store only
lists keys that look like hashes, so the file was never a candidate. A hex seed
made it fail properly.

## Alternatives considered

**Switch on `data-theme`.** Wrong for the case that was reported: the rails that
need the other mark are the ones a *workspace* coloured, in an instance whose
theme has not changed at all.

**Ask the theme compiler which treatment the rail has.** It knows the treatment
and not the colour — `accent` is whatever hex the workspace chose, and judging
"accent is dark" would be true for navy and false for pale yellow.

**Let the administrator pick per workspace.** The question *„das System sollte
dann selbst erkennen"* asks for the opposite, and a setting per workspace per
surface is a grid of decisions to keep in step with colours somebody else edits.

**Derive one mark from the other** — invert it, or recolour it. A logo is not
ours to repaint, and an inverted PNG of a coloured mark is a different logo.

**Composite semi-transparent surfaces properly.** The interface has none, and
guessing at a blend would be a second, wronger answer than the one the browser
already computed.
