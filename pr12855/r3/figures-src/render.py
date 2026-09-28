"""PIL card renderer for PR evidence figures.

Each card is a text file: line 1 title, line 2 subtitle, then body lines.
Body prefixes pick a colour: '## ' heading, '++ ' pass, '-- ' fail,
'!! ' warning, '== ' muted; anything else is plain text.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
FG = (230, 237, 243)
COLORS = {
    '## ': (88, 166, 255),
    '++ ': (63, 185, 80),
    '-- ': (248, 81, 73),
    '!! ': (210, 153, 34),
    '== ': (139, 148, 158),
}
MONO = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
MONO_B = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
TITLE = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 40)
SUB = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 26)


def render(src, dst):
    lines = open(src, encoding='utf-8').read().rstrip('\n').split('\n')
    title, sub, body = lines[0], lines[1], lines[2:]
    probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    pad, lh = 48, 38
    width = max(
        [probe.textlength(title, font=TITLE), probe.textlength(sub, font=SUB)]
        + [probe.textlength(l[3:] if l[:3] in COLORS else l, font=MONO_B) for l in body]
    )
    w = int(width + pad * 2)
    h = int(pad + 56 + 44 + 24 + lh * len(body) + pad)
    img = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(img)
    d.text((pad, pad), title, font=TITLE, fill=FG)
    d.text((pad, pad + 58), sub, font=SUB, fill=(139, 148, 158))
    d.line((pad, pad + 100, w - pad, pad + 100), fill=(48, 54, 61), width=2)
    y = pad + 118
    for l in body:
        prefix = l[:3]
        if prefix in COLORS:
            font = MONO_B if prefix == '## ' else MONO
            d.text((pad, y), l[3:], font=font, fill=COLORS[prefix])
        else:
            d.text((pad, y), l, font=MONO, fill=FG)
        y += lh
    img.save(dst, optimize=True)
    print(dst, img.size)


if __name__ == '__main__':
    for src in sys.argv[1:]:
        render(src, src.rsplit('.', 1)[0] + '.png')
