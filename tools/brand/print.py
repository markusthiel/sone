import os, cairosvg
from gen import OUT
SVG=os.path.join(OUT,"logo/svg")
files=["sone-logo-horizontal-light","sone-logo-horizontal-black","sone-logo-horizontal-white",
"sone-logo-horizontal-claim-light","sone-logo-horizontal-claim-black","sone-logo-horizontal-claim-white",
"sone-logo-vertical-claim-light","sone-logo-vertical-claim-black","sone-signet-light","sone-signet-black","sone-signet-white"]
os.makedirs(os.path.join(OUT,"print/pdf"),exist_ok=True)
os.makedirs(os.path.join(OUT,"print/svg"),exist_ok=True)
import shutil
for f in files:
    src=f"{SVG}/{f}.svg"
    # 60mm wide at 72dpi-in-pt: 60mm = 170.08pt
    cairosvg.svg2pdf(url=src, write_to=os.path.join(OUT,f"print/pdf/{f}.pdf"), output_width=170.08)
    shutil.copy(src, os.path.join(OUT,f"print/svg/{f}.svg"))
print("pdf done", len(files))
