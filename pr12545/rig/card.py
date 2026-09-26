# Render a text card to PNG with line-prefix colouring.
#   "## " heading (blue)   "++ " good (green)   "-- " bad (red)
#   "!! " warn (amber)     "== " dim (grey)     otherwise plain
# usage: python3 card.py in.txt out.png "Title" "subtitle"
import sys
from PIL import Image, ImageDraw, ImageFont

src, out, title, subtitle = sys.argv[1:5]
lines = open(src, encoding='utf-8').read().rstrip('\n').split('\n')

MONO = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
MONO_B = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
TITLE = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 36)
SUB = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 24)

BG = (13, 17, 23)
FG = (201, 209, 217)
COLORS = {
    '## ': ((88, 166, 255), MONO_B),
    '++ ': ((63, 185, 80), MONO),
    '-- ': ((248, 81, 73), MONO),
    '!! ': ((210, 153, 34), MONO),
    '== ': ((139, 148, 158), MONO),
}
PAD = 44
LH = 36

probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
def style(line):
    for p, (c, f) in COLORS.items():
        if line.startswith(p):
            return line[len(p):], c, f
    return line, FG, MONO

w = max(probe.textlength(title, font=TITLE), probe.textlength(subtitle, font=SUB))
for l in lines:
    t, _, f = style(l)
    w = max(w, probe.textlength(t, font=f))
W = int(w) + PAD * 2
H = PAD + 48 + 38 + 22 + LH * len(lines) + PAD
img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)
d.text((PAD, PAD), title, font=TITLE, fill=(240, 246, 252))
d.text((PAD, PAD + 50), subtitle, font=SUB, fill=(139, 148, 158))
y0 = PAD + 50 + 38 + 16
d.line([(PAD, y0 - 6), (W - PAD, y0 - 6)], fill=(48, 54, 61), width=2)
y = y0 + 6
for l in lines:
    t, c, f = style(l)
    d.text((PAD, y), t, font=f, fill=c)
    y += LH
img.save(out, optimize=True)
print(out, img.size)
