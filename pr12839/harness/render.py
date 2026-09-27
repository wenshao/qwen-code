"""Render evidence cards for PR 12839 with PIL (English only; Menlo has no CJK)."""
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
FG = (201, 209, 217)
COLORS = {
    '## ': (88, 166, 255),   # section heading
    '++ ': (63, 185, 80),    # confirmed / pass
    '!! ': (240, 136, 62),   # finding
    '-- ': (248, 81, 73),    # unsafe outcome
    '== ': (139, 148, 158),  # summary / muted
}
MONO = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
MONO_B = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
TITLE = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 40)
SUB = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 26)
PAD, LINE = 48, 38


def render(src, out):
    lines = open(src, encoding='utf-8').read().rstrip('\n').split('\n')
    title, subtitle, body = lines[0], lines[1], lines[3:]
    probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    width = max([probe.textlength(title, font=TITLE), probe.textlength(subtitle, font=SUB)]
                + [probe.textlength(l[3:] if l[:3] in COLORS else l, font=MONO_B) for l in body])
    w = int(width) + 2 * PAD + 20
    h = PAD + 56 + 44 + 24 + LINE * len(body) + PAD
    img = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(img)
    d.text((PAD, PAD), title, font=TITLE, fill=(240, 246, 252))
    d.text((PAD, PAD + 58), subtitle, font=SUB, fill=(139, 148, 158))
    d.line((PAD, PAD + 104, w - PAD, PAD + 104), fill=(48, 54, 61), width=2)
    y = PAD + 124
    for l in body:
        prefix = l[:3]
        if prefix in COLORS:
            color, text = COLORS[prefix], l[3:]
            font = MONO_B if prefix in ('## ', '!! ', '-- ') else MONO
            if prefix in ('!! ', '-- '):
                d.rectangle((PAD - 16, y + 2, PAD - 10, y + LINE - 6), fill=color)
        else:
            color, text, font = FG, l, MONO
        d.text((PAD, y), text, font=font, fill=color)
        y += LINE
    img.save(out, optimize=True)
    print(out, img.size)


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2])
