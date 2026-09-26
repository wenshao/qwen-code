# Minimal evidence-card renderer: text specs and ANSI terminal frames -> PNG (PIL, Menlo).
import re, sys, json
from PIL import Image, ImageDraw, ImageFont
BG = (13, 17, 23); FG = (201, 209, 217)
COL = {'##': (88, 166, 255), '++': (63, 185, 80), '--': (248, 81, 73), '!!': (210, 153, 34), '==': (139, 148, 158)}
F = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26)
FB = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 26, index=1)
FT = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 34, index=1)
LH = 36; PAD = 36
SUB = {'◆︎': '*', '◆': '*', '⏸': '||', '➜': '>', '●︎': '*', '●': '*', '︎': ''}
def clean(s):
    for a, b in SUB.items(): s = s.replace(a, b)
    return s
ANSI16 = [(72,79,88),(255,123,114),(63,185,80),(210,153,34),(88,166,255),(188,140,255),(57,197,207),(177,186,196),
          (110,118,129),(255,161,152),(86,211,100),(227,179,65),(121,192,255),(210,168,255),(86,212,221),(240,246,252)]
def c256(n):
    if n < 16: return ANSI16[n]
    if n < 232:
        n -= 16; r, g, b = n // 36, (n // 6) % 6, n % 6
        f = lambda v: 0 if v == 0 else 55 + v * 40
        return (f(r), f(g), f(b))
    v = 8 + (n - 232) * 10; return (v, v, v)
def parse_ansi(line):
    spans = []; fg = FG; bold = False; pos = 0
    for m in re.finditer(r'\x1b\[([0-9;]*)m', line):
        if m.start() > pos: spans.append((line[pos:m.start()], fg, bold))
        pos = m.end(); codes = [int(c) if c else 0 for c in m.group(1).split(';')]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0: fg, bold = FG, False
            elif c == 1: bold = True
            elif c == 22: bold = False
            elif 30 <= c <= 37: fg = ANSI16[c - 30]
            elif 90 <= c <= 97: fg = ANSI16[c - 90 + 8]
            elif c == 39: fg = FG
            elif c == 38 and i + 1 < len(codes):
                if codes[i+1] == 5: fg = c256(codes[i+2]); i += 2
                elif codes[i+1] == 2: fg = tuple(codes[i+2:i+5]); i += 4
            i += 1
    if pos < len(line): spans.append((line[pos:], fg, bold))
    return [(re.sub(r'\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07', '', clean(t)), f, b) for t, f, b in spans]
def render(items, out, width=None):
    # items: list of ('title', text) | ('line', text) | ('ansi', raw) | ('gap', px)
    rows = []
    for kind, v in items:
        if kind == 'title': rows.append(('title', v))
        elif kind == 'gap': rows.append(('gap', v))
        elif kind == 'ansi': rows.append(('spans', parse_ansi(v)))
        else:
            pre = v[:2]
            if pre in COL: rows.append(('spans', [(clean(v[3:]), COL[pre], pre == '##')]))
            else: rows.append(('spans', [(clean(v[3:] if v.startswith('   ') else v), FG, False)]))
    d0 = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    w = 0; h = PAD
    for kind, v in rows:
        if kind == 'title': w = max(w, d0.textlength(v, font=FT)); h += 52
        elif kind == 'gap': h += v
        else: w = max(w, sum(d0.textlength(t, font=FB if b else F) for t, _, b in v)); h += LH
    W = int(width or w + 2 * PAD); H = h + PAD
    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img); y = PAD
    for kind, v in rows:
        if kind == 'title': d.text((PAD, y), v, font=FT, fill=(240, 246, 252)); y += 52
        elif kind == 'gap': y += v
        else:
            x = PAD
            for t, f, b in v:
                d.text((x, y), t, font=FB if b else F, fill=f); x += d.textlength(t, font=FB if b else F)
            y += LH
    img.save(out, optimize=True); print(out, img.size)
if __name__ == '__main__':
    spec = json.load(open(sys.argv[1])); render([tuple(x) for x in spec['items']], sys.argv[2])
