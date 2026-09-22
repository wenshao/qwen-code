from PIL import Image, ImageDraw, ImageFont
import os
S = '/root/verify/pr12466-harness/shots'; O = '/root/verify/pr12466-publish/pr-12466'
F = lambda n: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', n)
BG = (246, 248, 250); INK = (31, 35, 40); RED = (207, 34, 46); GREEN = (26, 127, 55)
def load(name, box=None, scale=1.0):
    im = Image.open(os.path.join(S, name)).convert('RGB')
    if box: im = im.crop(box)
    if scale != 1.0: im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    return im
def labelled(panels, title=None, pad=28, gap=28, cap=46, direction='h'):
    # panels: [(image, caption, color)]
    w = [p[0].width for p in panels]; h = [p[0].height for p in panels]
    top = (60 if title else 0)
    if direction == 'h':
        W = sum(w) + gap * (len(panels) - 1) + 2 * pad; H = max(h) + cap + 2 * pad + top
    else:
        W = max(w) + 2 * pad; H = sum(h) + (cap + gap) * len(panels) - gap + 2 * pad + top
    c = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(c)
    if title: d.text((pad, pad - 4), title, font=F(30), fill=INK)
    x, y = pad, pad + top
    for im, text, color in panels:
        d.text((x, y), text, font=F(24), fill=color or INK)
        c.paste(im, (x, y + cap)); d.rectangle([x - 1, y + cap - 1, x + im.width, y + cap + im.height], outline=(208, 215, 222), width=2)
        if direction == 'h': x += im.width + gap
        else: y += im.height + cap + gap
    return c
def save(img, name):
    img.save(os.path.join(O, name), optimize=True); print(name, img.size, os.path.getsize(os.path.join(O, name)) // 1024, 'KB')
# 1. entry: base vs PR
save(labelled([(load('hover-base.png'), 'Base c83265ff36 — Copy · Edit', None), (load('hover-head.png'), 'PR d10c768 — Copy · View tool calls · Edit', GREEN)], direction='v'), '01-entry-base-vs-pr.png')
# 2. full window: real cold daemon, overview turn, recorded start/end tooltip
save(load('dark-en-US-tooltip.png', scale=0.62), '02-panel-real-daemon.png')
# 3. details: shell / edit diff / MCP JSON (panel crops)
crop = (0, 160, 1000, 1500)
save(labelled([(load('dark-en-US-shell-expanded.png', (0, 160, 1000, 900), 0.8), 'Shell: command / result / Other', None),
               (load('dark-en-US-edit-expanded.png', (0, 160, 1000, 1500), 0.8), 'Edit: arguments + recorded diff', None),
               (load('dark-en-US-mcp-expanded.png', (0, 160, 1000, 1500), 0.8), 'MCP filter: 2 of 11, JSON args/result', None)]), '03-row-details.png')
# 4. live: running clock -> settled with recorded timing
P = (2120, 0, 3120, 700)
save(labelled([(load('live-running.png', P, 0.8), 'Running (+3.9 s): live clock, 0 history reads', None),
               (load('live-settled.png', P, 0.8), 'Settled: 8 s, mid-turn message did not split the turn', None)]), '04-live-running-settled.png')
# 5. defect A/B: sender tab identity
D = (2120, 0, 3120, 1060)
save(labelled([(load('live2-L1-dup-options.png', D, 0.8), 'PR head (sender tab): prompt listed twice', RED),
               (load('live2-fix-L1-dup-options.png', D, 0.8), 'With suggested 12-line fix: listed once', GREEN)]), '05-sender-tab-duplicate-ab.png')
# 6. zh-CN light + 110-call loop-capped turn
save(labelled([(load('light-zh-full-overview.png', (2120, 0, 3120, 1880), 0.6), 'zh-CN, light theme', None),
               (load('light-zh-bulkcap.png', (0, 0, 1000, 1880), 0.6), 'Loop-capped turn: 110 of 110 listed', None)]), '06-zh-light-and-110-calls.png')
