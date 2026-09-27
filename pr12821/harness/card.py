#!/usr/bin/env python3
"""Render an evidence card: card.py <in.txt> <out.png>
First line = title, second = subtitle. Line prefixes: '## ' section (blue), '++ ' good (green),
'-- ' bad (red), '!! ' warning (amber), '== ' muted (gray), '>> ' command (cyan)."""
import sys
from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8').read().rstrip('\n').split('\n')
title, subtitle, body = lines[0], lines[1], lines[2:]
S = 2  # scale
mono = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 13 * S, index=0)
bold = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 13 * S, index=1)
tfont = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 20 * S)
sfont = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 13 * S)
BG, FG = (13, 17, 23), (230, 237, 243)
COL = {'## ': (88, 166, 255), '++ ': (63, 185, 80), '-- ': (248, 81, 73), '!! ': (210, 153, 34), '== ': (139, 148, 158), '>> ': (86, 212, 221)}
pad, lh = 24 * S, 19 * S
d0 = ImageDraw.Draw(Image.new('RGB', (10, 10)))
def style(l):
  for k, c in COL.items():
    if l.startswith(k):
      return l[3:], c, bold if k == '## ' else mono
  return l, FG, mono
w = max([d0.textlength(title, font=tfont), d0.textlength(subtitle, font=sfont)] + [d0.textlength(style(l)[0], font=style(l)[2]) for l in body])
W = int(w + 2 * pad)
H = int(pad + 30 * S + 22 * S + 10 * S + lh * len(body) + pad)
img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)
y = pad
d.text((pad, y), title, font=tfont, fill=FG); y += 30 * S
d.text((pad, y), subtitle, font=sfont, fill=(139, 148, 158)); y += 22 * S
d.line((pad, y, W - pad, y), fill=(48, 54, 61), width=S); y += 10 * S
for l in body:
  text, color, font = style(l)
  d.text((pad, y), text, font=font, fill=color)
  y += lh
img.save(dst, optimize=True)
print(dst, img.size)
