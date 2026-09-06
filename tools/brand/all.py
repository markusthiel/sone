#!/usr/bin/env python3
"""Write the whole brand package.

    pip install fonttools brotli cairosvg
    python3 tools/brand/all.py            # -> ./brand/
    SONE_BRAND_OUT=/tmp/kit python3 tools/brand/all.py

Order matters: gen writes the SVG masters, everything after it reads them.
The Office files need node (`docx`, `pptxgenjs`) and are built by
letterhead.js and deck.js in this directory, which are not run from here.
"""
import runpy, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

for step in ("gen", "build", "social", "print", "fonts", "signature", "spec"):
    print(f"--- {step}")
    runpy.run_path(os.path.join(HERE, f"{step}.py"), run_name="__main__")
print("done")
