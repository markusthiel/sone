# ADR-0201: The small picture is the mark

## Status

Accepted. Built. Retires the three-bar build entirely, and changes the ground of
every shipped icon. Supersedes the small-size exception ADR-0132 and the brand
package were arranged around.

## Context

> Wenn ich beide apps als lokale apps abspeichere dann sehe ich ja die
> Kurz-Logos bzw Favicons. Die sind bei beiden nicht gleich.

Installed side by side, SONE and SOTE looked like two programs from different
houses. SONE's tile was ink black; SOTE's was paper. And SOTE's mark had three
rows where its interface draws four — it had copied SONE's small-size exception
rather than SONE's rule.

Both halves trace back to one decision recorded here twice: the three-bar build
for 16px, written into `favicon.svg`, into every icon up to 64px, into the
`favicon.ico`'s 16 and 32, and into `sone-signet-3bar-*.svg`. It was a
reasonable trade on its own terms — four bars do close up at tab size — and it
was made in the one place where the trade is worst.

**A favicon appears where nothing stands beside it.** In a tab, a dock, a home
screen, there is no wordmark, no interface, no second mark to compare against.
It is not a small version of the logo; for that moment it is the *whole* logo.
Spending exactly that surface on the variant that is not the mark gets the sign
backwards: the compromise belongs where the mark is one element among many, and
there is no such place.

The dark tile came with a matching argument — *"an icon does not know what is
behind it, and #161615 holds on a light dock, a dark taskbar and a browser tab
alike"*. True, and it answers a question nobody was asking. SOTE picked paper
and looked right; two applications from the same hand that disagree about their
own ground is the louder wrongness.

## Decision

**Four bars, every size, every file.** `BARS3`/`BOX3`, the `three=` parameter,
the 3-bar signet masters and the 3-bar tile are removed from `tools/brand/`
rather than left unused — an unused variant is a variant somebody reaches for.

**The shipped tile is the light one**: `#faf8f4` ground, `#161615` bars,
`#2f7d6f` accent — the `-light` colourway the brand package already defines.
The dark tile stays in the package (`sone-icon-tile-dark.svg`) for use on dark
surfaces, and the social avatar keeps it, because a profile picture is a
different surface with a different argument.

**SOTE follows, and gets the generator it never had.** Its icons were drawn by
hand, which is how they came to be three-row in the first place;
`tools/icons.py` now reads the geometry out of `Logo.tsx` and the colours out of
`styles.css`, as this repository has always done.

## Consequences

- At 16px the four bars are tight. That is the cost, accepted knowingly: it is
  legible, and a slightly denser picture of the right mark beats a clear picture
  of the wrong one.
- Everything derived is regenerated rather than edited: `brand/icons/**`,
  `brand/logo/svg/**`, the construction sheet, the social set. The rule that no
  asset is redrawn is what made that a command rather than an afternoon.
- `og-image.png` is unchanged — it was already the light card.
- The test that pinned the three-bar favicon now pins the four-bar light one,
  including that `#6fc0b0` does *not* appear. A test that only says "some
  accent" would have passed through this whole change.

## What was not done

**A separate optical build for 16px** — heavier bars, wider gaps, same four
rows. That is the honest way to have both legibility and the mark, and it is a
drawing decision rather than a code one. If the tab icon reads as a smudge on a
low-resolution screen, that is the next thing to try, not the three-bar build
coming back.
