# Minimal PIL card renderer. Line prefixes: "# " title, "> " subtitle, "## " section, "++ " green,
# "-- " red, "!! " amber, "== " gray, "   " / other: plain. Usage: render.py in.txt out.png
import sys
from PIL import Image, ImageDraw, ImageFont
BG = (13, 17, 23); FG = (230, 237, 243)
COL = {'# ': (255, 255, 255), '> ': (139, 148, 158), '## ': (88, 166, 255), '++ ': (63, 185, 80), '-- ': (248, 81, 73), '!! ': (210, 153, 34), '== ': (139, 148, 158)}
mono = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
bold = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
title = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 34, index=1)
lines = open(sys.argv[1], encoding='utf-8').read().rstrip('\n').split('\n')
def style(l):
    for p in ('## ', '++ ', '-- ', '!! ', '== ', '# ', '> '):
        if l.startswith(p):
            f = title if p == '# ' else bold if p == '## ' else mono
            return l[len(p):] if p in ('# ', '> ', '## ') else '   ' + l[len(p):], COL[p], f, (54 if p == '# ' else 38)
    return l, FG, mono, 34
pad = 36
probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
rows = [style(l) for l in lines]
w = max(probe.textlength(t, font=f) for t, c, f, h in rows) + 2 * pad
h = sum(hh for *_, hh in rows) + 2 * pad
img = Image.new('RGB', (int(w), int(h)), BG)
d = ImageDraw.Draw(img)
y = pad
for t, c, f, hh in rows:
    d.text((pad, y), t, font=f, fill=c)
    y += hh
img.save(sys.argv[2], optimize=True)
print(sys.argv[2], img.size)
