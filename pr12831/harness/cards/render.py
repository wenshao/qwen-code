# Minimal evidence-card renderer (PIL only). Line prefixes pick colours:
#   "## " heading, "++ " pass/green, "-- " fail/red, "!! " amber, "== " dim,
#   ">> " cyan (commands / probes). Everything else is plain text.
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
    '>> ': (86, 212, 221),
}
mono = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
bold = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
title_font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 40)
sub_font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 26)


def render(src, out):
    lines = open(src, encoding='utf8').read().rstrip('\n').split('\n')
    title, subtitle, body = lines[0], lines[1], lines[3:]
    probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    width = max(
        [probe.textlength(title, font=title_font), probe.textlength(subtitle, font=sub_font)]
        + [probe.textlength(l[3:] if l[:3] in COLORS else l, font=bold if l.startswith('## ') else mono) for l in body]
    )
    W = int(width) + 80
    lh = 36
    H = 40 + 56 + 44 + 20 + lh * len(body) + 40
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((40, 30), title, font=title_font, fill=FG)
    d.text((40, 86), subtitle, font=sub_font, fill=(139, 148, 158))
    d.line((40, 132, W - 40, 132), fill=(48, 54, 61), width=2)
    y = 150
    for l in body:
        prefix = l[:3]
        colour = COLORS.get(prefix)
        text = l[3:] if colour else l
        font = bold if prefix == '## ' else mono
        if prefix == '## ' and y > 150:
            y += 6
        d.text((40, y), text, font=font, fill=colour or FG)
        y += lh
    img = img.crop((0, 0, W, y + 30))
    img.save(out, optimize=True)
    print(out, img.size)


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2])
