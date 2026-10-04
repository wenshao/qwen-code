"""Render a text spec into a dark PNG evidence card (English only: Menlo has no CJK).

Line prefixes: '# ' title, '## ' section, '++ ' green, '-- ' red, '!! ' amber,
'== ' gray, '>> ' blue note, anything else plain. Inside a line, {g:..} {r:..}
{a:..} {d:..} {b:..} colour a segment green/red/amber/dim/blue.
usage: python3 card.py <spec.txt> <out.png>
"""
import re
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
COLORS = {
    '# ': (230, 237, 243),
    '## ': (88, 166, 255),
    '++ ': (63, 185, 80),
    '-- ': (248, 81, 73),
    '!! ': (210, 153, 34),
    '== ': (139, 148, 158),
    '>> ': (121, 192, 255),
}
INLINE = {
    'g': (63, 185, 80),
    'r': (248, 81, 73),
    'a': (210, 153, 34),
    'd': (139, 148, 158),
    'b': (121, 192, 255),
}
PLAIN = (201, 209, 217)
MENLO = '/System/Library/Fonts/Menlo.ttc'
SEGMENT = re.compile(r'\{([gradb]):([^{}]*)\}')

spec, out = sys.argv[1], sys.argv[2]
body = ImageFont.truetype(MENLO, 26, index=0)
bold = ImageFont.truetype(MENLO, 26, index=1)
title = ImageFont.truetype(MENLO, 34, index=1)


def segments(text, color):
    parts, last = [], 0
    for m in SEGMENT.finditer(text):
        if m.start() > last:
            parts.append((text[last:m.start()], color))
        parts.append((m.group(2), INLINE[m.group(1)]))
        last = m.end()
    if last < len(text):
        parts.append((text[last:], color))
    return parts


rows = []
for raw in open(spec, encoding='utf-8').read().rstrip('\n').split('\n'):
    for prefix in ('## ', '# ', '++ ', '-- ', '!! ', '== ', '>> '):
        if raw.startswith(prefix):
            text = raw[len(prefix):]
            font = title if prefix == '# ' else bold if prefix == '## ' else body
            rows.append((segments(text, COLORS[prefix]), font, 52 if prefix == '# ' else 40))
            break
    else:
        rows.append((segments(raw, PLAIN), body, 36 if raw else 18))

probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
width = max(int(sum(probe.textlength(t, font=f) for t, _ in segs)) for segs, f, _ in rows) + 80
height = sum(h for *_, h in rows) + 60
img = Image.new('RGB', (width, height), BG)
draw = ImageDraw.Draw(img)
y = 30
for segs, font, h in rows:
    x = 40
    for text, color in segs:
        draw.text((x, y), text, font=font, fill=color)
        x += draw.textlength(text, font=font)
    y += h
img.save(out, optimize=True)
print(out, img.size)
