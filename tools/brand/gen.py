#!/usr/bin/env python3
"""SONE brand asset generator.

One geometry definition, one colour table, every file derived from them.
The mark is the indented bar stack from packages/web/src/components/Logo.tsx,
unchanged. The wordmark is Archivo (wght 600) converted to outlines, so no
delivered file depends on a font being installed.
"""
import json, os, subprocess
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.misc.transform import Transform

import os as _os

_HERE = _os.path.dirname(_os.path.abspath(__file__))
ROOT = _os.path.abspath(_os.path.join(_HERE, "..", ".."))
FONTDIR = _os.path.join(ROOT, "packages", "web", "public", "fonts")

FONT = _os.path.join(FONTDIR, "archivo-latin-wght-normal.woff2")
FONT_EXT = _os.path.join(FONTDIR, "archivo-latin-ext-wght-normal.woff2")
OUT = _os.environ.get("SONE_BRAND_OUT") or _os.path.join(ROOT, "brand")

# --------------------------------------------------------------------------
# Colours (from packages/web/src/styles.css)
# --------------------------------------------------------------------------
INK = "#161615"        # --ink-900
PAPER = "#f7f5f0"      # --ink-050
PAGE_LIGHT = "#faf8f4" # manifest background_color
PAGE_DARK = "#0e0e0d"  # --ink-950
ACCENT_LIGHT = "#2f7d6f"  # --accent-500, light theme --accent
ACCENT_DARK = "#6fc0b0"   # --accent-300, dark theme --accent
MUTED_LIGHT = "#6a675f"   # --ink-500
MUTED_DARK = "#a9a79f"    # --ink-300

MODES = {
    #            bars      accent          claim
    "light": (INK, ACCENT_LIGHT, MUTED_LIGHT),
    "dark": (PAPER, ACCENT_DARK, MUTED_DARK),
    "black": (INK, INK, INK),
    "white": (PAPER, PAPER, PAPER),
}

# --------------------------------------------------------------------------
# The mark
# --------------------------------------------------------------------------
# Four bars, as shipped in Logo.tsx — and the only build there is (ADR-0201).
#
# A three-bar variant used to live here for 16px and for the icon tiles. It is
# gone: one mark, at every size, in both applications. What it cost was a
# favicon that was not the logo, and a sister application that had copied the
# exception rather than the rule.
BARS4 = [(12, 16, 76, 9, 0), (28, 37, 60, 9, 0), (44, 58, 44, 9, 1), (28, 79, 60, 9, 0)]
BOX4 = (12, 16, 88, 88)   # ink bounds


def bars_svg(bars, box, bar_col, accent_col, scale=1.0, dx=0.0, dy=0.0, indent=2):
    x0, y0 = box[0], box[1]
    pad = " " * indent
    out = []
    for (x, y, w, h, a) in bars:
        c = accent_col if a else bar_col
        out.append(
            f'{pad}<rect x="{(x-x0)*scale+dx:.4g}" y="{(y-y0)*scale+dy:.4g}" '
            f'width="{w*scale:.4g}" height="{h*scale:.4g}" fill="{c}"/>'
        )
    return "\n".join(out)


def mark_size(box, scale=1.0):
    return ((box[2] - box[0]) * scale, (box[3] - box[1]) * scale)


# --------------------------------------------------------------------------
# The wordmark and the claim, as outlines
# --------------------------------------------------------------------------
MONO = _os.path.join(FONTDIR, "jetbrains-mono-latin-wght-normal.woff2")


def text_path(text, wght, cap_target, tracking_em=0.0, src=None):
    """Return (path_d, advance_width, bbox) with baseline at y=0, y down."""
    src = src or FONT
    f = TTFont(src)
    f = instantiateVariableFont(f, {"wght": wght}, inplace=False, updateFontNames=False)
    upm = f["head"].unitsPerEm
    cap = f["OS/2"].sCapHeight
    scale = cap_target / cap
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    hmtx = f["hmtx"]
    track = tracking_em * upm
    parts, x = [], 0.0
    bounds = [None] * 4
    for i, ch in enumerate(text):
        gname = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.3f}")
        tp = TransformPen(pen, Transform(scale, 0, 0, -scale, x * scale, 0))
        gs[gname].draw(tp)
        cmds = pen.getCommands()
        if cmds:
            parts.append(cmds)
        bp = BoundsPen(gs)
        gs[gname].draw(TransformPen(bp, Transform(scale, 0, 0, -scale, x * scale, 0)))
        if bp.bounds:
            b = bp.bounds
            bounds = [
                b[0] if bounds[0] is None else min(bounds[0], b[0]),
                b[1] if bounds[1] is None else min(bounds[1], b[1]),
                b[2] if bounds[2] is None else max(bounds[2], b[2]),
                b[3] if bounds[3] is None else max(bounds[3], b[3]),
            ]
        x += hmtx[gname][0] + (track if i < len(text) - 1 else 0)
    return " ".join(parts), x * scale, bounds


NAME = "SONE"
CLAIM = "Wissen strukturieren. Auf deinem Server."
TRACK = 0.075

# reference metrics at cap height 100
_, W_NAME_100, _ = text_path(NAME, 600, 100, TRACK)
_, W_CLAIM_100, _ = text_path(CLAIM, 400, 100, 0.01)

# --------------------------------------------------------------------------
# Lockups
# --------------------------------------------------------------------------
MARK_H = 72.0                     # the mark's ink height, the unit everything scales from
CAP = MARK_H * 0.667              # 48 — wordmark cap height
GAP = MARK_H * 0.278              # 20 — mark to wordmark
W_NAME = W_NAME_100 * CAP / 100.0
CLAIM_CAP = 100.0 * W_NAME / W_CLAIM_100   # claim set to the wordmark's width
W_CLAIM = W_NAME
CLAIM_LEAD = CAP * 0.52


def svg(w, h, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.4g} {h:.4g}" '
        f'width="{w:.4g}" height="{h:.4g}" role="img" aria-label="{title}">\n'
        f'  <title>{title}</title>\n{body}\n</svg>\n'
    )


def signet(mode, adaptive=False):
    bars, box = BARS4, BOX4
    if adaptive:
        bar_col, acc = "currentColor", "var(--accent, #2f7d6f)"
    else:
        bar_col, acc, _ = MODES[mode]
    w, h = mark_size(box)
    return svg(w, h, bars_svg(bars, box, bar_col, acc), "SONE")


def lockup(mode, claim=False, vertical=False):
    bar_col, acc, claim_col = MODES[mode]
    d_name, _, _ = text_path(NAME, 600, CAP, TRACK)
    d_claim, _, _ = text_path(CLAIM, 400, CLAIM_CAP, 0.01)
    parts = []
    if not vertical:
        block_h = CAP + (CLAIM_LEAD + CLAIM_CAP if claim else 0)
        h = max(MARK_H, block_h)
        w = 76 + GAP + W_NAME
        my = (h - MARK_H) / 2
        parts.append(bars_svg(BARS4, BOX4, bar_col, acc, dy=my))
        ty = (h - block_h) / 2 + CAP
        parts.append(f'  <path d="{d_name}" fill="{bar_col}" transform="translate({76+GAP:.4g} {ty:.4g})"/>')
        if claim:
            parts.append(
                f'  <path d="{d_claim}" fill="{claim_col}" '
                f'transform="translate({76+GAP:.4g} {ty+CLAIM_LEAD+CLAIM_CAP:.4g})"/>'
            )
    else:
        # Stacked: the mark carries more weight on its own, so it grows until it
        # is about half the wordmark's width — otherwise it reads as a bullet.
        ms = (W_NAME * 0.48) / 76.0
        mw, mh = 76 * ms, MARK_H * ms
        vgap = mh * 0.30
        w = max(mw, W_NAME)
        h = mh + vgap + CAP + (CLAIM_LEAD + CLAIM_CAP if claim else 0)
        parts.append(bars_svg(BARS4, BOX4, bar_col, acc, scale=ms, dx=(w - mw) / 2))
        ty = mh + vgap + CAP
        parts.append(f'  <path d="{d_name}" fill="{bar_col}" transform="translate({(w-W_NAME)/2:.4g} {ty:.4g})"/>')
        if claim:
            parts.append(
                f'  <path d="{d_claim}" fill="{claim_col}" '
                f'transform="translate({(w-W_CLAIM)/2:.4g} {ty+CLAIM_LEAD+CLAIM_CAP:.4g})"/>'
            )
    return svg(w, h, "\n".join(parts), "SONE — Wissen strukturieren. Auf deinem Server.")


def tile(size=100, bg=PAGE_LIGHT, bar_col=INK, acc=ACCENT_LIGHT, inset=0.14, radius=0.0):
    """A square app-icon tile: mark centred in the tile with `inset` margin."""
    bars, box = BARS4, BOX4
    mw, mh = mark_size(box)
    avail = size * (1 - 2 * inset)
    s = min(avail / mw, avail / mh)
    dx = (size - mw * s) / 2
    dy = (size - mh * s) / 2
    r = f' rx="{radius*size:.4g}"' if radius else ""
    body = f'  <rect width="{size}" height="{size}" fill="{bg}"{r}/>\n' + bars_svg(
        bars, box, bar_col, acc, scale=s, dx=dx, dy=dy
    )
    return svg(size, size, body, "SONE")


def write(path, content):
    p = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(content)
    return p


if __name__ == "__main__":
    print(f"wordmark width at cap {CAP:.1f} = {W_NAME:.2f}")
    print(f"claim cap {CLAIM_CAP:.2f}, width {W_CLAIM:.2f}")
    n = 0
    for mode in MODES:
        n += bool(write(f"logo/svg/sone-signet-{mode}.svg", signet(mode)))
        n += bool(write(f"logo/svg/sone-logo-horizontal-{mode}.svg", lockup(mode)))
        n += bool(write(f"logo/svg/sone-logo-horizontal-claim-{mode}.svg", lockup(mode, claim=True)))
        n += bool(write(f"logo/svg/sone-logo-vertical-{mode}.svg", lockup(mode, vertical=True)))
        n += bool(write(f"logo/svg/sone-logo-vertical-claim-{mode}.svg", lockup(mode, vertical=True, claim=True)))
    write("logo/svg/sone-signet-adaptive.svg", signet("light", adaptive=True))
    print("svg files:", n + 1)
