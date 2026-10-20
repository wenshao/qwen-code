#!/usr/bin/env python3
"""Compose report figures for PR #14858 from the raw captures."""
import json
import os
import textwrap
from PIL import Image, ImageDraw, ImageFont

R = '/root/verify/pr14858'
OUT = f'{R}/report/img'
os.makedirs(OUT, exist_ok=True)
BG = (13, 17, 23)
FG = (208, 215, 222)
DIM = (139, 148, 158)
RED = (255, 123, 114)
GREEN = (126, 231, 135)
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
SANSB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
CJK = None
for c in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
          '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
          '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc']:
    if os.path.exists(c):
        CJK = c
        break


def font(path, size):
    return ImageFont.truetype(path, size)


def trim(img, pad=18, thresh=38):
    g = img.convert('L').point(lambda v: 255 if v > thresh else 0)
    box = g.getbbox()
    if not box:
        return img
    l, t, r, b = box
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


def label_bar(width, text, color, size=30, bold=True):
    f = font(SANSB if bold else SANS, size)
    h = size + 22
    im = Image.new('RGB', (width, h), BG)
    ImageDraw.Draw(im).text((18, 10), text, font=f, fill=color)
    return im


def stack(parts, width=None):
    width = width or max(p.width for p in parts)
    h = sum(p.height for p in parts)
    out = Image.new('RGB', (width, h), BG)
    y = 0
    for p in parts:
        out.paste(p, (0, y))
        y += p.height
    return out


def sep(width, h=6, color=(48, 54, 61)):
    return Image.new('RGB', (width, h), color)


# ---------- Web Shell ----------
CAUSES = [
    ('explicit', 'Explicit cap: model.maxToolCallsPerTurn = 3'),
    ('stuck', 'Stuck halt: adaptive default, one call repeated, past 100 calls'),
    ('backstop', 'Backstop: adaptive default, 1025 distinct calls (no repeats)'),
    ('repeated', 'Heuristic duplicate: model.skipLoopDetection = false'),
    ('replay', 'Provider replay: same tool-call id + arguments sent 3 times'),
    ('invalid', 'Invalid tool params: read_file without file_path, 3 rounds'),
    ('failing', 'Repeated execution failure (guard=enforce): missing file, 3 batches'),
]


def ws_band(arm, cause, name):
    im = Image.open(f'{R}/shots/{arm}-{cause}/{name}.png').convert('RGB')
    im = im.crop((730, 0, im.width - 20, im.height))  # drop the sidebar
    return trim(im)


def webshell_figure(lang, name, fname):
    W = 1840
    parts = []
    for cause, title in CAUSES:
        parts.append(label_bar(W, title, FG, 34))
        for arm, tag, col in [('base', 'before: merge-base ae126a0365', RED), ('head', 'after: PR head d4c44dc80b', GREEN)]:
            band = ws_band(arm, cause, name)
            if band.width > W:
                band = band.resize((W, int(band.height * W / band.width)))
            parts.append(label_bar(W, tag, col, 26, bold=False))
            canvas = Image.new('RGB', (W, band.height), BG)
            canvas.paste(band, (0, 0))
            parts.append(canvas)
        parts.append(sep(W))
    stack(parts, W).save(f'{OUT}/{fname}', optimize=True)


webshell_figure('en', 'live-en', 'webshell-en-before-after.png')
webshell_figure('zh-CN', 'reload-zh-CN', 'webshell-zh-CN-before-after.png')

# head only, the three reload states of one cause (live / reload / zh)
for cause in ['explicit', 'stuck']:
    parts = []
    W = 1840
    for name, title in [('live-en', 'typed live (en)'), ('reload-en', 'after page reload (en)'), ('reload-zh-CN', 'after reload, zh-CN')]:
        band = ws_band('head', cause, name)
        parts.append(label_bar(W, f'PR head: {title}', GREEN, 26, bold=False))
        canvas = Image.new('RGB', (W, band.height), BG)
        canvas.paste(band.resize((min(W, band.width), int(band.height * min(W, band.width) / band.width))), (0, 0))
        parts.append(canvas)
    stack(parts, W).save(f'{OUT}/webshell-{cause}-head-live-reload-zh.png', optimize=True)

# ---------- TUI dialog ----------
def tui_crop(path):
    im = Image.open(path).convert('RGB')
    return trim(im, pad=10, thresh=45)


rows = []
for scen, title in [('explicit', 'TUI loop dialog, explicit cap 3'), ('stuck', 'TUI loop dialog, stuck halt'),
                    ('replay', 'TUI loop dialog, provider replay'), ('repeated', 'TUI loop dialog, heuristic duplicate')]:
    b = tui_crop(f'{R}/runs/base/tui-{scen}/tui-dialog.png')
    h = tui_crop(f'{R}/runs/head/tui-{scen}/tui-dialog.png')
    W = b.width + h.width + 30
    row = Image.new('RGB', (W, max(b.height, h.height) + 44), BG)
    d = ImageDraw.Draw(row)
    f = font(SANS, 20)
    d.text((10, 8), 'before (ae126a0365)', font=f, fill=RED)
    d.text((b.width + 40, 8), 'after (d4c44dc80b)', font=f, fill=GREEN)
    row.paste(b, (0, 40))
    row.paste(h, (b.width + 30, 40))
    rows.append(label_bar(W, title, FG, 24))
    rows.append(row)
    rows.append(sep(W, 4))
stack(rows).save(f'{OUT}/tui-dialog-before-after.png', optimize=True)

# after Esc: the info line
rows = []
for scen in ['explicit', 'stuck']:
    for arm, col in [('base', RED), ('head', GREEN)]:
        im = Image.open(f'{R}/runs/{arm}/tui-{scen}/tui-after.png').convert('RGB')
        im = trim(im, pad=10, thresh=45)
        rows.append(label_bar(im.width, f'{arm} · {scen} · message after Esc', col, 20, bold=False))
        rows.append(im)
    rows.append(sep(max(r.width for r in rows), 4))
stack(rows).save(f'{OUT}/tui-after-esc-before-after.png', optimize=True)

# ---------- OpenTUI ----------
rows = []
for arm, col in [('base', RED), ('head', GREEN)]:
    im = trim(Image.open(f'{R}/runs/{arm}/opentui-explicit/opentui.png').convert('RGB'), pad=10, thresh=45)
    rows.append(label_bar(im.width, f'OpenTUI renderer (bun), explicit cap 3 · {arm}', col, 20, bold=False))
    rows.append(im)
stack(rows).save(f'{OUT}/opentui-before-after.png', optimize=True)

# ---------- headless stderr ----------
def loop_line(arm, tag):
    for l in open(f'{R}/runs/{arm}/{tag}/stderr.txt').read().splitlines():
        if 'Loop detection' in l:
            return l
    return '(no loop line)'


cases = [('explicit', 'explicit cap 3'), ('stuck', 'stuck halt (adaptive)'), ('backstop', 'backstop (adaptive, 1025 calls)'),
         ('repeated', 'heuristic duplicate (skipLoopDetection=false)'), ('replay', 'provider replay'), ('consecutive', 'consecutive identical (control)')]
mf = font(MONO, 22)
lines = []
for tag, title in cases:
    lines.append((f'# {title}', FG, True))
    for arm, col, pre in [('base', RED, '- '), ('head', GREEN, '+ ')]:
        for i, w in enumerate(textwrap.wrap(loop_line(arm, tag), 112)):
            lines.append(((pre if i == 0 else '  ') + w, col, False))
    lines.append(('', FG, False))
W = 1660
H = 30 + 32 * len(lines)
im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
y = 16
bf = font(SANSB, 22)
for text, col, bold in lines:
    d.text((20, y), text, font=bf if bold else mf, fill=col)
    y += 32
im.save(f'{OUT}/headless-stderr-before-after.png', optimize=True)

# ---------- cold load ----------
rows = []
for arm, col in [('base', RED), ('head', GREEN)]:
    im = Image.open(f'{R}/shots/cold/{arm}-stuck-cold-en.png').convert('RGB')
    im = im.crop((730, 0, im.width, im.height))
    im = im.resize((im.width // 2, im.height // 2))
    rows.append(label_bar(im.width, f'{arm}: same stuck-halt session after a daemon restart', col, 18, bold=False))
    rows.append(im)
stack(rows).save(f'{OUT}/webshell-cold-load-both-arms.png', optimize=True)
print('CJK font', CJK)
for f in sorted(os.listdir(OUT)):
    p = f'{OUT}/{f}'
    print(f, Image.open(p).size, os.path.getsize(p))

# per-cause before/after images, one per language
for lang, name in [('en', 'live-en'), ('zh-CN', 'reload-zh-CN')]:
    for cause, title in CAUSES:
        W = 1840
        parts = [label_bar(W, title, FG, 34)]
        for arm, tag, col in [('base', 'before: merge-base ae126a0365', RED), ('head', 'after: PR head d4c44dc80b', GREEN)]:
            band = ws_band(arm, cause, name)
            parts.append(label_bar(W, tag, col, 26, bold=False))
            canvas = Image.new('RGB', (W, band.height), BG)
            canvas.paste(band, (0, 0))
            parts.append(canvas)
        stack(parts, W).save(f'{OUT}/ws-{cause}-{lang}.png', optimize=True)
os.remove(f'{OUT}/webshell-en-before-after.png')
os.remove(f'{OUT}/webshell-zh-CN-before-after.png')
