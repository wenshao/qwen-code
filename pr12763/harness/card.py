"""Render a text card to PNG. Line prefixes pick the colour:
'# ' title, '> ' subtitle, '## ' section, '++ ' green, '-- ' red,
'!! ' amber, '== ' grey, anything else default. Inline spans:
{g:text} green, {r:text} red, {a:text} amber, {d:text} grey, {b:text} blue."""
import re
import sys
from PIL import Image, ImageDraw, ImageFont

BG = (13, 17, 23)
FG = (230, 237, 243)
COL = {
    'g': (63, 185, 80), 'r': (248, 81, 73), 'a': (210, 153, 34),
    'd': (139, 148, 158), 'b': (88, 166, 255), 'f': FG,
}
MONO = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=0)
MONO_B = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
TITLE = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 34, index=1)
SUB = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 24, index=0)
SPAN = re.compile(r'\{([gradbf]):((?:[^{}])*)\}')


def parse(line):
    """-> (font, default colour, [(text, colour)], extra spacing)"""
    font, col, pad = MONO, FG, 0
    for pre, f, c, p in (('# ', TITLE, FG, 14), ('> ', SUB, COL['d'], 6),
                         ('## ', MONO_B, COL['b'], 12), ('++ ', MONO, COL['g'], 0),
                         ('-- ', MONO, COL['r'], 0), ('!! ', MONO, COL['a'], 0),
                         ('== ', MONO, COL['d'], 0)):
        if line.startswith(pre):
            line, font, col, pad = line[len(pre):], f, c, p
            break
    parts, pos = [], 0
    for m in SPAN.finditer(line):
        if m.start() > pos:
            parts.append((line[pos:m.start()], col))
        parts.append((m.group(2), COL[m.group(1)]))
        pos = m.end()
    parts.append((line[pos:], col))
    return font, parts, pad


def main(src, out):
    lines = open(src, encoding='utf8').read().rstrip('\n').split('\n')
    probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    rows = [parse(l) for l in lines]
    width = 0
    height = 40
    for font, parts, pad in rows:
        w = sum(probe.textlength(t, font=font) for t, _ in parts)
        width = max(width, w)
        height += font.size + 12 + pad
    img = Image.new('RGB', (int(width) + 80, height + 30), BG)
    d = ImageDraw.Draw(img)
    y = 40
    for font, parts, pad in rows:
        x = 40
        for t, c in parts:
            d.text((x, y), t, font=font, fill=c)
            x += d.textlength(t, font=font)
        y += font.size + 12 + pad
    img.save(out, optimize=True)
    print(out, img.size)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
