#!/usr/bin/env python3
"""Compose the report figures from the raw captures."""
from PIL import Image, ImageDraw, ImageFont

R = '/root/verify/pr12434-harness'
OUT = f'{R}/report'
import os
os.makedirs(OUT, exist_ok=True)
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
title_font = ImageFont.truetype(FB, 30)
cap_font = ImageFont.truetype(F, 24)
BG = (246, 248, 250)
INK = (31, 35, 40)
MUTED = (87, 96, 106)
RED = (207, 34, 46)
GREEN = (26, 127, 55)


def panel(img, title, caption, color=INK, pad=20):
    w, h = img.size
    head = 50 + (34 * len(caption.split('\n')) if caption else 0)
    canvas = Image.new('RGB', (w + pad * 2, h + head + pad * 2), BG)
    d = ImageDraw.Draw(canvas)
    d.text((pad, pad), title, font=title_font, fill=color)
    if caption:
        d.multiline_text((pad, pad + 44), caption, font=cap_font, fill=MUTED, spacing=8)
    canvas.paste(img, (pad, pad + head))
    d.rectangle([pad - 1, pad + head - 1, pad + w, pad + head + h], outline=(208, 215, 222), width=1)
    return canvas


def row(images, gap=24, bg=BG):
    h = max(i.size[1] for i in images)
    w = sum(i.size[0] for i in images) + gap * (len(images) - 1)
    c = Image.new('RGB', (w, h), bg)
    x = 0
    for i in images:
        c.paste(i, (x, 0))
        x += i.size[0] + gap
    return c


def col(images, gap=24, bg=BG):
    w = max(i.size[0] for i in images)
    h = sum(i.size[1] for i in images) + gap * (len(images) - 1)
    c = Image.new('RGB', (w, h), bg)
    y = 0
    for i in images:
        c.paste(i, (0, y))
        y += i.size[1] + gap
    return c


def banner(text, width, size=34):
    f = ImageFont.truetype(FB, size)
    c = Image.new('RGB', (width, size + 36), BG)
    ImageDraw.Draw(c).text((20, 18), text, font=f, fill=INK)
    return c


def crop_top(path, h):
    im = Image.open(path)
    return im.crop((0, 0, im.size[0], min(h, im.size[1])))


# Fig 1 — base vs head on the same real 300-turn session
b = crop_top(f'{R}/out/base-chromium-big/step0-initial.png', 640)
h0 = crop_top(f'{R}/out/head-chromium-big/step0-initial.png', 640)
h3 = crop_top(f'{R}/out/head-chromium-big/step3-tail.png', 640)
fig1 = row([
    panel(b, 'Base (main @ 8f86b4f)', '20 of 300 turns; the notice is inert —\nno way to reach older records'),
    panel(h0, 'PR head — first page', 'Same 20 turns, plus the\n"Load earlier records" control'),
    panel(h3, 'PR head — after 3 real clicks', '80 turns held (4 pages = the cap);\nthe control becomes the capacity notice'),
])
fig1 = col([banner('Real qwen serve daemon · real 300-turn / 3,700-record session · Chromium', fig1.size[0]), fig1], gap=0)
fig1.save(f'{OUT}/fig1-base-vs-head.png', optimize=True)

# Fig 2 — anchoring with the guide line pinned to the anchor row's top edge
a0 = Image.open(f'{R}/figs/anchor-head-before.png')
a1 = Image.open(f'{R}/figs/anchor-head-after.png')
fig2 = row([
    panel(a0, 'Before the click', 'Reader mid-table on "Prompt #291"\n154 rows · scrollTop 2251'),
    panel(a1, 'After the older page lands', '308 rows · scrollTop 7487 (+5236 = 154 × 34 px)\nrow still on the red line: moved 0 px', color=GREEN),
])
fig2 = col([banner('Prepend correction holds the reader (real mouse click, real daemon, production bundle)', fig2.size[0], 30), fig2], gap=0)
fig2.save(f'{OUT}/fig2-anchor-holds.png', optimize=True)


# Fig 3 — the final page moves the reader 3.5 px; a fixed bar height removes it
def z(path, k=2):
    im = Image.open(path)
    return im.resize((im.size[0] * k // 1, im.size[1] * k // 1), Image.NEAREST)


eh0, eh1 = z(f'{R}/figs/endshift-head-before.png'), z(f'{R}/figs/endshift-head-after.png')
ef0, ef1 = z(f'{R}/figs/endshift-fix-before.png'), z(f'{R}/figs/endshift-fix-after.png')
bh0, bh1 = Image.open(f'{R}/figs/endshift-head-bar-before.png'), Image.open(f'{R}/figs/endshift-head-bar-after.png')
bf0, bf1 = Image.open(f'{R}/figs/endshift-fix-bar-before.png'), Image.open(f'{R}/figs/endshift-fix-bar-after.png')
top = row([
    panel(eh0, 'PR head — before last page (×2)', 'row top on the red line'),
    panel(eh1, 'PR head — after last page (×2)', 'row sits 3.5 px ABOVE the line', color=RED),
])
mid = row([
    panel(ef0, 'Suggested patch — before (×2)', 'row top on the red line'),
    panel(ef1, 'Suggested patch — after (×2)', 'row still on the line: 0 px', color=GREEN),
])
bars = row([
    panel(bh0, 'PR head bar: button', '34.5 px tall'),
    panel(bh1, 'PR head bar: notice', '31 px tall (min-height) → rows rise 3.5 px', color=RED),
    panel(bf0, 'Patch bar: button', '35 px'),
    panel(bf1, 'Patch bar: notice', '35 px', color=GREEN),
], gap=16)
fig3 = col([banner('Walk reaches the session start mid-table: the bar shrinks 34.5 → 31 px and the rows move with it', max(top.size[0], bars.size[0]), 30), top, mid, bars])
fig3.save(f'{OUT}/fig3-final-page-shift.png', optimize=True)

# Fig 4 — failed older read, then retry at the same cursor
r0 = crop_top(f'{R}/out/head-chromium-faults/retry-1-failed.png', 600)
r1 = crop_top(f'{R}/out/head-chromium-faults/retry-2-recovered.png', 600)
fig4 = row([
    panel(r0, 'Older read answered 500', '154 rows and scrollTop 2251 kept;\nalert adds 57 px above the table'),
    panel(r1, '"Try again" → same cursor, real daemon', '308 rows; newest page read once in total;\nanchor back at its pre-click y (0 px)', color=GREEN),
])
fig4 = col([banner('Failure is retried where it failed (500 injected on the first cursor read only)', fig4.size[0], 30), fig4], gap=0)
fig4.save(f'{OUT}/fig4-retry.png', optimize=True)

for f in sorted(os.listdir(OUT)):
    im = Image.open(f'{OUT}/{f}')
    print(f, im.size, os.path.getsize(f'{OUT}/{f}'))
