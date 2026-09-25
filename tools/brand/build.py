#!/usr/bin/env python3
"""Raster and container formats, all derived from the generated SVG masters."""
import io, os, json
import cairosvg
from PIL import Image
from gen import (
    OUT, tile, signet, lockup, write, INK, PAPER, PAGE_LIGHT, PAGE_DARK,
    ACCENT_LIGHT, ACCENT_DARK, MUTED_LIGHT, MUTED_DARK, MODES, W_NAME, CAP,
)

SVG = os.path.join(OUT, "logo/svg")


def png_from_svg_str(s, w=None, h=None):
    return cairosvg.svg2png(bytestring=s.encode(), output_width=w, output_height=h)


def png(src_svg_path, out_path, width):
    data = cairosvg.svg2png(url=src_svg_path, output_width=width)
    p = os.path.join(OUT, out_path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)
    return p


# --------------------------------------------------------------------------
# 1. Logo PNGs (transparent background)
# --------------------------------------------------------------------------
count = 0
for mode in ("light", "dark", "black", "white"):
    for w in (400, 800, 1600, 2400):
        png(f"{SVG}/sone-logo-horizontal-{mode}.svg",
            f"logo/png/sone-logo-horizontal-{mode}-{w}.png", w); count += 1
        png(f"{SVG}/sone-logo-horizontal-claim-{mode}.svg",
            f"logo/png/sone-logo-horizontal-claim-{mode}-{w}.png", w); count += 1
    for w in (400, 800, 1600):
        png(f"{SVG}/sone-logo-vertical-{mode}.svg",
            f"logo/png/sone-logo-vertical-{mode}-{w}.png", w); count += 1
        png(f"{SVG}/sone-logo-vertical-claim-{mode}.svg",
            f"logo/png/sone-logo-vertical-claim-{mode}-{w}.png", w); count += 1
    for w in (64, 128, 256, 512, 1024):
        png(f"{SVG}/sone-signet-{mode}.svg",
            f"logo/png/sone-signet-{mode}-{w}.png", w); count += 1
print("logo pngs:", count)

# --------------------------------------------------------------------------
# 2. Favicons and app icons
#
# The shipped tile is the LIGHT one at every size, and four bars at every size
# (ADR-0201). Both were the other way round and both were wrong in the same
# way: an installed application showed something that was not the logo — a dark
# tile beside SOTE's light one, and three bars beside the four the interface
# draws all day.
# --------------------------------------------------------------------------
TILE_LIGHT = dict(bg=PAGE_LIGHT, bar_col=INK, acc=ACCENT_LIGHT)
TILE_DARK = dict(bg=INK, bar_col=PAPER, acc=ACCENT_DARK)

# Both tiles stay in the package — somebody putting the mark on a dark surface
# needs the dark one — but only the light one is shipped as an icon.
write("icons/svg/sone-icon-tile-light.svg", tile(100, **TILE_LIGHT))
write("icons/svg/sone-icon-tile-dark.svg", tile(100, **TILE_DARK))
write("icons/svg/favicon.svg", tile(100, **TILE_LIGHT))
# maskable: the mark inside the 80% safe circle, so a round or squircle crop
# never clips a bar.
write("icons/svg/sone-icon-maskable.svg", tile(100, inset=0.26, **TILE_LIGHT))

ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 384, 512, 1024]
for s in ICON_SIZES:
    svg_str = tile(100, **TILE_LIGHT)
    name = {180: "apple-touch-icon", 192: "icon-192", 512: "icon-512"}.get(s, f"icon-{s}")
    data = png_from_svg_str(svg_str, w=s, h=s)
    p = os.path.join(OUT, f"icons/png/{name}.png")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

# maskable PWA icons
for s in (192, 512):
    data = png_from_svg_str(tile(100, inset=0.26, **TILE_LIGHT), w=s, h=s)
    open(os.path.join(OUT, f"icons/png/icon-maskable-{s}.png"), "wb").write(data)

# monochrome / Safari pinned tab and Windows tile
write("icons/svg/sone-icon-mono-black.svg", signet("black"))
write("icons/svg/sone-icon-mono-white.svg", signet("white"))

# favicon.ico — the same four-bar light tile at all three sizes (ADR-0201).
ims = []
for s in (16, 32, 48):
    ims.append(Image.open(io.BytesIO(png_from_svg_str(tile(100, **TILE_LIGHT), s, s))).convert("RGBA"))
ims[0].save(os.path.join(OUT, "icons/favicon.ico"), format="ICO",
            sizes=[(16, 16), (32, 32), (48, 48)], append_images=ims[1:])

# manifest
manifest = {
    "name": "SONE",
    "short_name": "SONE",
    "description": "Notizen, Seiten und Sammlungen, auf deinem eigenen Server.",
    "start_url": "/",
    "scope": "/",
    "display": "standalone",
    "background_color": PAGE_LIGHT,
    "theme_color": PAGE_LIGHT,
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
        {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
write("icons/manifest.webmanifest", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
print("icons done")
