#!/usr/bin/env python3
"""Evidence card renderer (PIL). Line prefixes pick colours:
'## ' heading blue, '++ ' green, '-- ' red, '!! ' amber, '== ' grey, else default."""
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
FG = (201, 209, 217)
COLORS = {'## ': (88, 166, 255), '++ ': (63, 185, 80), '-- ': (248, 81, 73), '!! ': (210, 153, 34), '== ': (139, 148, 158)}
MONO = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
BOLD = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
TITLE = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 38)
SUB = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 26)


def render(src, out):
    lines = open(src, encoding='utf8').read().rstrip('\n').split('\n')
    title, subtitle, body = lines[0], lines[1], lines[3:]
    probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    width = max([probe.textlength(title, font=TITLE), probe.textlength(subtitle, font=SUB)] +
                [probe.textlength(l[3:] if l[:3] in COLORS else l, font=BOLD if l.startswith('## ') else MONO) for l in body])
    lh = 36
    w = int(width) + 80
    h = 40 + 50 + 40 + 20 + lh * len(body) + 40
    img = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(img)
    d.text((40, 30), title, font=TITLE, fill=(240, 246, 252))
    d.text((40, 82), subtitle, font=SUB, fill=(139, 148, 158))
    d.line((40, 128, w - 40, 128), fill=(48, 54, 61), width=2)
    y = 146
    for l in body:
        pre = l[:3]
        color = COLORS.get(pre, FG)
        text = l[3:] if pre in COLORS else l
        d.text((40, y), text, font=BOLD if pre == '## ' else MONO, fill=color)
        y += lh
    img.save(out, optimize=True)
    print(out, img.size)


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2])
