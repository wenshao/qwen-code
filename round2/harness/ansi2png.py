#!/usr/bin/env python3
"""Render a tmux `capture-pane -e` dump (ANSI SGR) to a PNG terminal screenshot."""
import re, sys
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SIZE = 15
PAD = 14
TITLEBAR = 30

BG = (13, 17, 23)
FG = (201, 209, 217)

BASE16 = [
    (0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16),
    (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
    (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67),
    (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255),
]

def xterm256(n):
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        r, g, b = n // 36, (n // 6) % 6, n % 6
        f = lambda v: 0 if v == 0 else 55 + 40 * v
        return (f(r), f(g), f(b))
    v = 8 + (n - 232) * 10
    return (v, v, v)

SGR = re.compile(r"\x1b\[([0-9;:]*)m")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(\x07|\x1b\\)")
CSI_OTHER = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

def parse_line(line):
    """-> list of (char, fg, bg, bold)"""
    line = OSC.sub("", line)
    cells = []
    fg, bg, bold = FG, None, False
    i = 0
    while i < len(line):
        m = SGR.match(line, i)
        if m:
            params = m.group(1)
            parts = [p for p in params.split(";")] if params else ["0"]
            j = 0
            while j < len(parts):
                p = parts[j] or "0"
                try:
                    v = int(p)
                except ValueError:
                    j += 1
                    continue
                if v == 0:
                    fg, bg, bold = FG, None, False
                elif v == 1:
                    bold = True
                elif v == 22:
                    bold = False
                elif 30 <= v <= 37:
                    fg = BASE16[v - 30]
                elif v == 39:
                    fg = FG
                elif 40 <= v <= 47:
                    bg = BASE16[v - 40]
                elif v == 49:
                    bg = None
                elif 90 <= v <= 97:
                    fg = BASE16[v - 90 + 8]
                elif 100 <= v <= 107:
                    bg = BASE16[v - 100 + 8]
                elif v in (38, 48):
                    target = "fg" if v == 38 else "bg"
                    if j + 1 < len(parts) and parts[j + 1] == "5":
                        col = xterm256(int(parts[j + 2]))
                        j += 2
                    elif j + 1 < len(parts) and parts[j + 1] == "2":
                        col = (int(parts[j + 2]), int(parts[j + 3]), int(parts[j + 4]))
                        j += 4
                    else:
                        j += 1
                        continue
                    if target == "fg":
                        fg = col
                    else:
                        bg = col
                j += 1
            i = m.end()
            continue
        m2 = CSI_OTHER.match(line, i)
        if m2:
            i = m2.end()
            continue
        if line[i] == "\x1b":
            i += 1
            continue
        cells.append((line[i], fg, bg, bold))
        i += 1
    return cells

def render(src, dst, title, crop_top=0, crop_bottom=None):
    raw = open(src, "r", encoding="utf-8", errors="replace").read().split("\n")
    if crop_bottom is None:
        crop_bottom = len(raw)
    raw = raw[crop_top:crop_bottom]
    rows = [parse_line(l) for l in raw]
    while rows and not "".join(c[0] for c in rows[-1]).strip():
        rows.pop()
    cols = max((len(r) for r in rows), default=80)
    cols = max(cols, len(title) + 4)

    f = ImageFont.truetype(FONT, SIZE)
    fb = ImageFont.truetype(FONT_B, SIZE)
    bbox = f.getbbox("M")
    cw = f.getlength("M")
    ch = SIZE + 5

    W = int(cw * cols) + PAD * 2
    H = int(ch * len(rows)) + PAD * 2 + TITLEBAR
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # title bar
    d.rectangle([0, 0, W, TITLEBAR], fill=(30, 36, 44))
    for k, col in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([12 + k * 18, 10, 22 + k * 18, 20], fill=col)
    d.text((78, 6), title, font=fb, fill=(180, 190, 200))

    y = TITLEBAR + PAD
    for row in rows:
        x = PAD
        for chx, fg, bg, bold in row:
            if bg:
                d.rectangle([x, y, x + cw, y + ch], fill=bg)
            if chx != " ":
                d.text((x, y), chx, font=(fb if bold else f), fill=fg)
            x += cw
        y += ch
    img.save(dst)
    print(f"{dst}  {W}x{H}  rows={len(rows)} cols={cols}")

if __name__ == "__main__":
    src, dst, title = sys.argv[1], sys.argv[2], sys.argv[3]
    ct = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    cb = int(sys.argv[5]) if len(sys.argv) > 5 else None
    render(src, dst, title, ct, cb)
