import os, shutil
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from gen import OUT, FONT, FONT_EXT, MONO
D=os.path.join(OUT,"fonts")
os.makedirs(os.path.join(D,"webfonts"),exist_ok=True)
os.makedirs(os.path.join(D,"desktop"),exist_ok=True)
for f in [FONT, FONT_EXT, MONO]:
    shutil.copy(f, os.path.join(D,"webfonts",os.path.basename(f)))
for lic in ["Archivo-OFL.txt","JetBrainsMono-OFL.txt"]:
    shutil.copy(os.path.join(FONTDIR, lic), os.path.join(D,lic))
JOBS=[(FONT,"Archivo",[("Regular",400),("Medium",500),("SemiBold",600),("Bold",700)]),
      (MONO,"JetBrainsMono",[("Regular",400),("Medium",500)])]
for src,fam,insts in JOBS:
    for name,w in insts:
        f=TTFont(src)
        f=instantiateVariableFont(f,{"wght":w},inplace=False,updateFontNames=True)
        f.flavor=None
        out=os.path.join(D,"desktop",f"{fam}-{name}.ttf")
        f.save(out)
print(sorted(os.listdir(os.path.join(D,"desktop"))))
