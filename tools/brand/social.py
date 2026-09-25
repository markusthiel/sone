#!/usr/bin/env python3
"""Social cards, repo banner, avatar."""
import os, io
import cairosvg
from gen import (
    OUT, write, text_path, MONO, bars_svg, BARS4, BOX4, tile,
    INK, PAPER, PAGE_LIGHT, PAGE_DARK, ACCENT_LIGHT, ACCENT_DARK,
    MUTED_LIGHT, MUTED_DARK, W_NAME_100, TRACK,
)

KICKER = "NOTIZEN · SEITEN · SAMMLUNGEN"
CLAIM = "Wissen strukturieren. Auf deinem Server."


def card(w, h, dark=False, mark_h=None, margin=None, kicker=True):
    """One editorial card: rule, kicker, mark + wordmark, claim.

    Everything is derived from the card's height, so 1200x630 and 1280x640 are
    the same drawing at two sizes rather than two layouts.
    """
    bg = INK if dark else PAGE_LIGHT
    ink = PAPER if dark else INK
    acc = ACCENT_DARK if dark else ACCENT_LIGHT
    muted = MUTED_DARK if dark else MUTED_LIGHT
    rule = "#302f2c" if dark else "#ddd9d0"

    m = margin if margin is not None else round(h * 0.115)
    mh = mark_h if mark_h is not None else h * 0.185          # mark ink height
    ms = mh / 72.0
    cap = mh * 0.667                                          # wordmark cap
    gap = mh * 0.278
    wname = W_NAME_100 * cap / 100.0
    d_name, _, _ = text_path("SONE", 600, cap, TRACK)

    claim_cap = h * 0.046
    d_claim, w_claim, _ = text_path(CLAIM, 400, claim_cap, 0.005)

    kick_cap = h * 0.0225
    d_kick, w_kick, _ = text_path(KICKER, 500, kick_cap, 0.14, src=MONO)

    parts = [f'  <rect width="{w}" height="{h}" fill="{bg}"/>']

    y = m
    if kicker:
        parts.append(f'  <rect x="{m}" y="{y}" width="{w-2*m}" height="1" fill="{rule}"/>')
        y += kick_cap * 2.0
        parts.append(f'  <path d="{d_kick}" fill="{muted}" transform="translate({m} {y:.4g})"/>')

    # the lockup, optically centred in what is left
    block_h = mh
    ly = y + (h - m - y - block_h) * 0.42
    parts.append(bars_svg(BARS4, BOX4, ink, acc, scale=ms, dx=m, dy=ly))
    parts.append(
        f'  <path d="{d_name}" fill="{ink}" '
        f'transform="translate({m + 76*ms + gap:.4g} {ly + mh/2 + cap/2:.4g})"/>'
    )

    # claim on the bottom margin line
    parts.append(f'  <path d="{d_claim}" fill="{muted}" transform="translate({m} {h-m:.4g})"/>')
    # the accent, once: a short bar under the claim, the third-bar move again
    parts.append(
        f'  <rect x="{m}" y="{h-m+claim_cap*0.75:.4g}" width="{claim_cap*2.4:.4g}" '
        f'height="{claim_cap*0.30:.4g}" fill="{acc}"/>'
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" '
        f'height="{h}" role="img" aria-label="SONE — {CLAIM}">\n  <title>SONE</title>\n'
        + "\n".join(parts) + "\n</svg>\n"
    )


def rast(svg_str, path, w, h):
    data = cairosvg.svg2png(bytestring=svg_str.encode(), output_width=w, output_height=h)
    p = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)


if __name__ == "__main__":
    jobs = [
        ("og-image", 1200, 630),
        ("repo-banner", 1280, 640),
        ("twitter-card", 1200, 600),
    ]
    for name, w, h in jobs:
        for suffix, dark in (("light", False), ("dark", True)):
            s = card(w, h, dark=dark)
            write(f"social/svg/sone-{name}-{suffix}.svg", s)
            rast(s, f"social/png/sone-{name}-{suffix}.png", w, h)
    # a wide header (X / LinkedIn banner): same card, taller margins
    for suffix, dark in (("light", False), ("dark", True)):
        s = card(1500, 500, dark=dark, mark_h=90, margin=64)
        write(f"social/svg/sone-header-1500x500-{suffix}.svg", s)
        rast(s, f"social/png/sone-header-1500x500-{suffix}.png", 1500, 500)

    # avatar: the tile, four bars, at the sizes profiles ask for
    av = tile(100, bg=INK, bar_col=PAPER, acc=ACCENT_DARK, inset=0.18)
    write("social/svg/sone-avatar.svg", av)
    for s in (400, 512, 1024):
        rast(av, f"social/png/sone-avatar-{s}.png", s, s)
    print("social done")
