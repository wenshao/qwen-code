#!/usr/bin/env python3
"""Figure helpers for the PR 11636 report.

  compose.py panels OUT.png "TITLE" IMG1 "LABEL1" IMG2 "LABEL2" [...] [--crop x,y,w,h] [--scale 0.5]
      side-by-side labelled panels (crop in ORIGINAL pixel coords, applied to every image)
  compose.py text OUT.png "TITLE" FILE.txt
      render a plain-text timeline/table as a terminal-style PNG
"""
import sys
from PIL import Image, ImageDraw, ImageFont

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG = (13, 17, 23)
FG = (230, 237, 243)
DIM = (139, 148, 158)
GREEN = (63, 185, 80)
RED = (248, 81, 73)
AMBER = (210, 153, 34)


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def panels(out, title, pairs, crop=None, scale=0.5):
    imgs = []
    for path, label in pairs:
        im = Image.open(path).convert("RGB")
        if crop:
            x, y, w, h = crop
            im = im.crop((x, y, x + w, y + h))
        if scale != 1:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        imgs.append((im, label))
    pad, head, lab = 24, 64, 44
    width = sum(i.width for i, _ in imgs) + pad * (len(imgs) + 1)
    height = head + lab + max(i.height for i, _ in imgs) + pad
    canvas = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(canvas)
    d.text((pad, 18), title, font=font(BOLD, 28), fill=FG)
    x = pad
    for im, label in imgs:
        color = GREEN if label.startswith("PR") else RED if label.startswith("base") else AMBER
        d.text((x, head + 6), label, font=font(BOLD, 22), fill=color)
        canvas.paste(im, (x, head + lab))
        d.rectangle((x - 1, head + lab - 1, x + im.width, head + lab + im.height), outline=(48, 54, 61))
        x += im.width + pad
    canvas.save(out)
    print(out, canvas.size)


def text(out, title, src):
    lines = open(src, encoding="utf-8").read().rstrip("\n").split("\n")
    f = font(MONO, 20)
    lh = 28
    width = max(900, int(max(f.getlength(l) for l in lines)) + 60)
    height = 80 + lh * len(lines) + 30
    canvas = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(canvas)
    d.text((30, 20), title, font=font(BOLD, 26), fill=FG)
    y = 72
    for l in lines:
        color = FG
        if l.startswith("#"):
            color = DIM
        elif "[PR]" in l or l.startswith("PR "):
            color = GREEN
        elif "[base]" in l or l.startswith("base "):
            color = RED
        elif l.startswith("!"):
            color = AMBER
            l = l[1:]
        d.text((30, y), l, font=f, fill=color)
        y += lh
    canvas.save(out)
    print(out, canvas.size)


if __name__ == "__main__":
    mode, out, title, *rest = sys.argv[1:]
    crop = None
    scale = 0.5
    if "--crop" in rest:
        i = rest.index("--crop")
        crop = tuple(int(v) for v in rest[i + 1].split(","))
        del rest[i : i + 2]
    if "--scale" in rest:
        i = rest.index("--scale")
        scale = float(rest[i + 1])
        del rest[i : i + 2]
    if mode == "panels":
        panels(out, title, list(zip(rest[0::2], rest[1::2])), crop, scale)
    else:
        text(out, title, rest[0])
