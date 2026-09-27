# PIL evidence cards for the PR 12840 report. Line prefixes pick colours:
# "## " heading, "++ " pass, "-- " fail, "!! " warning, "== " muted.
import json, sys
from PIL import Image, ImageDraw, ImageFont

SP = "/path/to/scratchpad"
OUT = f"{SP}/shots"
BG = (13, 17, 23)
FG = (230, 237, 243)
COL = {"## ": (121, 192, 255), "++ ": (63, 185, 80), "-- ": (248, 81, 73), "!! ": (210, 153, 34), "== ": (139, 148, 158)}
MONO = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 26)
MONO_B = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 26, index=1)
TITLE = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 40)
SUB = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 26)
PAD = 40
LH = 36


def text_block(lines):
    width = 0
    for line in lines:
        prefix = line[:3] if line[:3] in COL else ""
        font = MONO_B if prefix == "## " else MONO
        width = max(width, ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(line[len(prefix):], font=font))
    return int(width), len(lines) * LH


def draw_lines(d, x, y, lines):
    for line in lines:
        prefix = line[:3] if line[:3] in COL else ""
        font = MONO_B if prefix == "## " else MONO
        d.text((x, y), line[len(prefix):], font=font, fill=COL.get(prefix, FG))
        y += LH
    return y


def card(name, title, subtitle, lines, images=()):
    tw, th = text_block(lines)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    width = max(tw, int(probe.textlength(title, font=TITLE)), int(probe.textlength(subtitle, font=SUB)), *[im.width for _, im in images]) + 2 * PAD
    height = PAD + 56 + 44 + 8 + th + sum(im.height + LH + 20 for _, im in images) + 2 * PAD + 40
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    d.text((PAD, PAD), title, font=TITLE, fill=FG)
    d.text((PAD, PAD + 56), subtitle, font=SUB, fill=COL["== "])
    y = draw_lines(d, PAD, PAD + 56 + 44 + 8, lines)
    for label, im in images:
        y += 12
        prefix = label[:3] if label[:3] in COL else ""
        d.text((PAD, y), label[len(prefix):], font=MONO_B, fill=COL.get(prefix, FG))
        y += LH
        img.paste(im, (PAD, y))
        d.rectangle([PAD - 1, y - 1, PAD + im.width, y + im.height], outline=(48, 54, 61))
        y += im.height + 8
    img = img.crop((0, 0, width, y + PAD))
    img.save(f"{OUT}/{name}.png", optimize=True)
    print(name, img.size)


if __name__ == "__main__":
    import importlib
    spec = json.load(open(sys.argv[1]))
    for c in spec:
        imgs = []
        for label, path, box in c.get("images", []):
            im = Image.open(path).convert("RGB").crop(tuple(box))
            imgs.append((label, im))
        card(c["name"], c["title"], c["subtitle"], c["lines"], imgs)
