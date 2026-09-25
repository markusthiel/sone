#!/usr/bin/env python3
"""Construction sheet: clear space and minimum sizes, drawn rather than described."""
import os, cairosvg
from gen import (
    OUT, write, text_path, MONO, bars_svg, BARS4, BOX4,
    INK, PAPER, PAGE_LIGHT, ACCENT_LIGHT, MUTED_LIGHT, W_NAME_100, TRACK,
)

RULE = "#ddd9d0"
GUIDE = "#3f9a89"


def label(text, x, y, cap=8.5, col=MUTED_LIGHT, anchor="start"):
    d, w, _ = text_path(text, 500, cap, 0.12, src=MONO)
    dx = x - (w if anchor == "end" else w / 2 if anchor == "middle" else 0)
    return f'  <path d="{d}" fill="{col}" transform="translate({dx:.4g} {y:.4g})"/>'


def sheet():
    W, H = 1000, 700
    p = [f'  <rect width="{W}" height="{H}" fill="{PAGE_LIGHT}"/>']

    # --- clear space, on the horizontal lockup -------------------------------
    ms = 1.5
    mw, mh = 76 * ms, 72 * ms                      # 114 x 108
    cap = mh * 0.667
    gap = mh * 0.278
    wname = W_NAME_100 * cap / 100.0
    d_name, _, _ = text_path("SONE", 600, cap, TRACK)
    q = mh / 4.0                                   # the clear space unit: 1/4 mark height
    lw = mw + gap + wname
    ox, oy = 90, 120

    # clear-space frame
    p.append(
        f'  <rect x="{ox-q:.4g}" y="{oy-q:.4g}" width="{lw+2*q:.4g}" height="{mh+2*q:.4g}" '
        f'fill="none" stroke="{GUIDE}" stroke-width="1" stroke-dasharray="5 4"/>'
    )
    p.append(
        f'  <rect x="{ox:.4g}" y="{oy:.4g}" width="{lw:.4g}" height="{mh:.4g}" '
        f'fill="none" stroke="{RULE}" stroke-width="1"/>'
    )
    p.append(bars_svg(BARS4, BOX4, INK, ACCENT_LIGHT, scale=ms, dx=ox, dy=oy))
    p.append(f'  <path d="{d_name}" fill="{INK}" transform="translate({ox+mw+gap:.4g} {oy+mh/2+cap/2:.4g})"/>')

    # the unit, shown as a square
    p.append(f'  <rect x="{ox-q:.4g}" y="{oy-q:.4g}" width="{q:.4g}" height="{q:.4g}" fill="{GUIDE}" opacity="0.16"/>')
    p.append(label("A = 1/4 H", ox - q, oy - q - 12))
    p.append(label("H = HOEHE DES SIGNETS", ox + lw + 2 * q + 14, oy + mh / 2 + 3))
    p.append(f'  <rect x="{ox+lw+q+6:.4g}" y="{oy:.4g}" width="1" height="{mh:.4g}" fill="{GUIDE}"/>')
    p.append(label("SCHUTZRAUM: MINDESTENS A AUF ALLEN VIER SEITEN", ox - q, oy + mh + 2 * q + 26))

    # --- minimum sizes -------------------------------------------------------
    y2 = 380
    p.append(f'  <rect x="90" y="{y2-30}" width="{W-180}" height="1" fill="{RULE}"/>')
    p.append(label("MINDESTGROESSEN", 90, y2 - 12, cap=9, col=INK))

    x = 90
    for cap_label, kind, target_h in (
        ("SIGNET  AB 24 PX", "s4", 24),
        ("LOCKUP  AB 96 PX BREITE", "lock", 22),
    ):
        if kind == "lock":
            s = 96.0 / (76 + 20 + W_NAME_100 * 48 / 100)
            c = 72 * s * 0.667
            dn, _, _ = text_path("SONE", 600, c, TRACK)
            p.append(bars_svg(BARS4, BOX4, INK, ACCENT_LIGHT, scale=s, dx=x, dy=y2 + 30 - 72 * s / 2))
            p.append(f'  <path d="{dn}" fill="{INK}" transform="translate({x+76*s+20*s:.4g} {y2+30+c/2:.4g})"/>')
            w_used = 96
        else:
            bars, box = BARS4, BOX4
            s = target_h / (box[3] - box[1])
            p.append(bars_svg(bars, box, INK, ACCENT_LIGHT, scale=s, dx=x, dy=y2 + 30 - target_h / 2))
            w_used = (box[2] - box[0]) * s
        p.append(label(cap_label, x, y2 + 78))
        x += max(w_used, 210) + 60

    # --- colour ---------------------------------------------------------------
    y3 = 520
    p.append(f'  <rect x="90" y="{y3-30}" width="{W-180}" height="1" fill="{RULE}"/>')
    p.append(label("FARBE", 90, y3 - 12, cap=9, col=INK))
    swatches = [
        ("#161615", "INK 900", True), ("#f7f5f0", "INK 050", False),
        ("#2f7d6f", "ACCENT 500", True), ("#6fc0b0", "ACCENT 300", False),
        ("#6a675f", "INK 500", True), ("#faf8f4", "PAGE", False),
    ]
    x = 90
    for hexv, name, dark in swatches:
        p.append(f'  <rect x="{x}" y="{y3+6}" width="118" height="56" fill="{hexv}" stroke="{RULE}" stroke-width="1"/>')
        p.append(label(name, x, y3 + 82))
        p.append(label(hexv.upper(), x, y3 + 98, col="#8a8880"))
        x += 136

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'role="img" aria-label="SONE — Konstruktion, Schutzraum, Mindestgroessen, Farbe">\n'
        f'  <title>SONE Markensystem — Konstruktionsblatt</title>\n' + "\n".join(p) + "\n</svg>\n"
    )


if __name__ == "__main__":
    s = sheet()
    write("guideline/sone-konstruktion.svg", s)
    cairosvg.svg2png(bytestring=s.encode(), write_to=os.path.join(OUT, "guideline/sone-konstruktion.png"), output_width=2000)
    cairosvg.svg2pdf(bytestring=s.encode(), write_to=os.path.join(OUT, "guideline/sone-konstruktion.pdf"), output_width=780)
    print("spec done")
