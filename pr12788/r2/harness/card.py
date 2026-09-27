"""Render a text evidence card: card.py <out.png> <text file>.

Line prefixes pick the colour: '# ' title, '## ' heading, '++ ' green,
'-- ' red, '!! ' amber, '== ' muted; anything else is plain text.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
COLORS = {"++ ": (63, 185, 80), "-- ": (248, 81, 73), "!! ": (210, 153, 34),
          "== ": (139, 148, 158), "## ": (88, 166, 255)}
FG = (230, 237, 243)
MENLO = "/System/Library/Fonts/Menlo.ttc"
body = ImageFont.truetype(MENLO, 26)
bold = ImageFont.truetype(MENLO, 26, index=1)
title = ImageFont.truetype(MENLO, 32, index=1)


def main(out, path):
    lines = open(path).read().rstrip("\n").split("\n")
    styled = []
    for line in lines:
        if line.startswith("# "):
            styled.append((line[2:], title, FG, 52))
        elif line[:3] in COLORS:
            font = bold if line[:3] == "## " else body
            styled.append((line[3:], font, COLORS[line[:3]], 36))
        else:
            styled.append((line, body, FG, 36))
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    width = max(probe.textlength(t, font=f) for t, f, _, _ in styled)
    W = int(width) + 100
    H = sum(h for *_, h in styled) + 80
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 40
    for text, font, color, h in styled:
        d.text((50, y), text, font=font, fill=color)
        y += h
    img.save(out, optimize=True)
    print(out, W, H)


if __name__ == "__main__":
    main(*sys.argv[1:])
