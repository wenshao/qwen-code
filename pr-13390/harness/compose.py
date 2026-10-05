# Side-by-side crops of the real TUI screenshots (base | PR). Only crops and
# captions are added; every terminal pixel comes from the captured PNGs.
from PIL import Image, ImageDraw, ImageFont
R = '/root/verify/pr13390/tui-runs'
BG = (13, 17, 23)
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
f_title = ImageFont.truetype(BOLD, 34)
f_cap = ImageFont.truetype(MONO, 28)
f_gap = ImageFont.truetype(MONO, 24)
X0, X1 = 40, 1130
def y(i):  # top pixel of 1-based screen line i
    return 80 + (i - 1) * 38
def crop(arm, shot, a, b):
    return Image.open(f'{R}/{arm}/shots/{shot}.png').crop((X0, y(a), X1, y(b + 1) + 4))
def column(arm, shot, spans, title, title_color, caption, cap_color):
    parts = [crop(arm, shot, a, b) for a, b in spans]
    gap = 54
    h = 70 + sum(p.height for p in parts) + gap * (len(parts) - 1) + 120
    col = Image.new('RGB', (X1 - X0, h), BG)
    d = ImageDraw.Draw(col)
    d.text((24, 18), title, font=f_title, fill=title_color)
    yy = 70
    for k, p in enumerate(parts):
        col.paste(p, (0, yy))
        yy += p.height
        if k < len(parts) - 1:
            d.text((60, yy + 12), '···  built-in detail rows cropped (identical in both arms)  ···', font=f_gap, fill=(120, 130, 145))
            yy += gap
    for n, line in enumerate(caption):
        d.text((24, yy + 20 + n * 40), line, font=f_cap, fill=cap_color)
    return col
def figure(shot, spans, out, heading, base_cap, head_cap):
    a = column('base', shot, spans, 'base fde56a8 (before the fix)', (255, 123, 114), base_cap, (255, 123, 114))
    b = column('head', shot, spans, 'PR #13390 @ 9c75b71', (126, 231, 135), head_cap, (126, 231, 135))
    W = a.width + b.width + 60
    H = max(a.height, b.height) + 90
    img = Image.new('RGB', (W, H), (1, 4, 9))
    d = ImageDraw.Draw(img)
    d.text((20, 22), heading, font=f_title, fill=(201, 209, 217))
    img.paste(a, (20, 80))
    img.paste(b, (a.width + 40, 80))
    img.save(out)
    print(out, img.size)
figure('1-before-first-reply', [(16, 28), (61, 65)], '/root/verify/pr13390/img/tui-before-first-reply.png',
       '/context detail before the first reply (estimate path) — code mode + always-loaded MCP server',
       ['MCP rows: 11.8k + 4.2k + 1.2k + 40 ≈ 17.2k', 'listed under an MCP tools row of 12.0k'],
       ['MCP rows: 8.2k + 2.9k + 857 + 28 ≈ 12.0k', 'adds up to the MCP tools row (12.0k)'])
figure('2-after-first-reply', [(20, 37), (70, 74)], '/root/verify/pr13390/img/tui-after-first-reply.png',
       '/context detail after the first reply (provider total 12,000 < overhead, so scale < 1)',
       ['MCP rows: 6.8k + 2.4k + 713 + 23 ≈ 9.9k', 'listed under an MCP tools row of 6.9k'],
       ['MCP rows: 4.7k + 1.7k + 494 + 16 ≈ 6.9k', 'adds up to the MCP tools row (6.9k)'])
