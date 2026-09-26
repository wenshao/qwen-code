# Renders a text card to PNG. Line prefixes pick the colour:
# "# " title, "## " section (blue), "++ " green, "-- " red, "!! " amber,
# "== " grey, anything else plain. Menlo has no CJK glyphs: English only.
import sys
from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
BG = (13, 17, 23)
COL = {'#': (240, 246, 252), '##': (121, 192, 255), '++': (86, 211, 100), '--': (248, 81, 73),
       '!!': (227, 179, 65), '==': (139, 148, 158), '': (201, 209, 217)}
body = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
bold = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
title = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 38)

rows = []
for raw in open(src).read().rstrip('\n').split('\n'):
    for p in ('##', '#', '++', '--', '!!', '=='):
        if raw.startswith(p + ' ') or raw == p:
            rows.append((p, raw[len(p) + 1:]))
            break
    else:
        rows.append(('', raw))

probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
def font(p):
    return title if p == '#' else bold if p in ('##', '--', '++', '!!') else body
def height(p):
    return 58 if p == '#' else 36
W = int(max(probe.textlength(t, font=font(p)) for p, t in rows)) + 80
Hh = sum(height(p) for p, _ in rows) + 60
img = Image.new('RGB', (W, Hh), BG)
d = ImageDraw.Draw(img)
y = 30
for p, t in rows:
    d.text((40, y), t, fill=COL[p], font=font(p))
    y += height(p)
img.save(dst, optimize=True)
print(dst, img.size)
