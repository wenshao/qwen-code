#!/usr/bin/env python3
"""Fig 2: settle time (prompt POST -> settled status) vs CPU quota, with the
old 1s and new 10s waitFor windows, plus the A/B verdict tallies per quota."""
import json, math, glob, re, random
R = '/root/verify/pr13323/runs'
conds = [('idle', 'no throttle', f'{R}/probe2-idle.jsonl'), ('5', '5% CPU', f'{R}/probe2-q5.jsonl'),
         ('3', '3% CPU', f'{R}/probe2-q3.jsonl'), ('2', '2% CPU', f'{R}/probe2-q2.jsonl')]
def tally(arm, q):
    fails = att = 0; runs = 0
    for f in glob.glob(f'{R}/ab/{arm}-q{q}-r*.log'):
        txt = re.sub(r'\x1b\[[0-9;]*m', '', open(f).read())
        lines = [l for l in txt.splitlines() if re.match(r'^ +[✓×] .*unknown Hook fence', l)]
        if len(lines) < 2: continue
        runs += 1
        for l in lines:
            m = re.search(r'retry x(\d)', l); k = int(m.group(1)) if m else 0
            att += k + 1
            fails += (k + 1) if '×' in l else k
    return att, fails
BLUE, ORANGE, GRID, INK, INK2, MUTED, SURF, CRIT, GOOD = '#2a78d6', '#eb6834', '#e4e3df', '#0b0b0b', '#52514e', '#8a8984', '#fcfcfb', '#d03b3b', '#0ca30c'
W, H, L, Rm, T, B = 820, 470, 78, 190, 56, 118
ymin, ymax = 10, 30000
y = lambda v: T + (H - T - B) * (1 - (math.log10(v) - 1) / (math.log10(ymax) - 1))
bandw = (W - L - Rm) / len(conds)
s = [f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif">']
s.append(f'<text x="{L}" y="20" font-size="15" font-weight="600" fill="{INK}">How long the turn takes to settle, by CPU available to the test</text>')
s.append(f'<text x="{L}" y="38" font-size="12" fill="{INK2}">PR head, main-CI config (coverage on), time from prompt POST to settled /status, polled every 10 ms · log scale</text>')
for v in (10, 30, 100, 300, 1000, 3000, 10000, 30000):
    yy = y(v); s.append(f'<line x1="{L}" x2="{W-Rm}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{GRID}"/>')
    s.append(f'<text x="{L-8}" y="{yy+4:.1f}" font-size="11.5" fill="{MUTED}" text-anchor="end">{v:,} ms</text>')
for v, lab, sub in ((1000, 'old window: 1,000 ms', 'vitest default (base)'), (10000, 'new window: 10,000 ms', '{ timeout: 10_000 } (PR)')):
    yy = y(v); s.append(f'<line x1="{L}" x2="{W-Rm+6}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{INK}" stroke-width="1.5"/>')
    s.append(f'<text x="{W-Rm+10}" y="{yy:.1f}" font-size="12" font-weight="600" fill="{INK}">{lab}</text>')
    s.append(f'<text x="{W-Rm+10}" y="{yy+15:.1f}" font-size="11.5" fill="{INK2}">{sub}</text>')
random.seed(7); counts = {}
for i, (q, lab, f) in enumerate(conds):
    cx = L + bandw * (i + 0.5)
    rows = [json.loads(l) for l in open(f)]
    counts[q] = len(rows)
    for r in rows:
        off = (-1 if not r['reload'] else 1) * bandw * 0.13 + random.uniform(-bandw * 0.08, bandw * 0.08)
        s.append(f'<circle cx="{cx+off:.1f}" cy="{y(max(r["settleMs"],10)):.1f}" r="4.5" fill="{BLUE if not r["reload"] else ORANGE}" stroke="{SURF}" stroke-width="2"/>')
    s.append(f'<text x="{cx:.1f}" y="{H-B+18}" font-size="12.5" font-weight="600" fill="{INK}" text-anchor="middle">{lab}</text>')
    s.append(f'<text x="{cx:.1f}" y="{H-B+33}" font-size="11" fill="{MUTED}" text-anchor="middle">n = {len(rows)}</text>')
    if q == '5':
        s.append(f'<rect x="{cx-bandw*0.46:.1f}" y="{T+4}" width="{bandw*0.92:.1f}" height="22" rx="4" fill="#f0efec"/>')
        s.append(f'<text x="{cx:.1f}" y="{T+19}" font-size="11" fill="{INK2}" text-anchor="middle">≈ load of the failing CI run</text>')
    if q != 'idle':
        for j, arm in enumerate(('base', 'head')):
            att, fails = tally(arm, q)
            ok = fails == 0
            s.append(f'<text x="{cx:.1f}" y="{H-B+54+j*17}" font-size="11.5" fill="{INK}" text-anchor="middle"><tspan fill="{GOOD if ok else CRIT}" font-weight="700">{"✓" if ok else "✕"}</tspan> {arm}: {fails} of {att} failed</text>')
    else:
        s.append(f'<text x="{cx:.1f}" y="{H-B+54}" font-size="11" fill="{MUTED}" text-anchor="middle">both arms pass</text>')
        s.append(f'<text x="{cx:.1f}" y="{H-B+71}" font-size="11" fill="{MUTED}" text-anchor="middle">(ladder, D = 0)</text>')
s.append(f'<text x="{L-8}" y="{H-B+62}" font-size="11" fill="{INK2}" text-anchor="end">A/B attempts</text>')
s.append(f'<text x="{L-8}" y="{H-B+76}" font-size="11" fill="{INK2}" text-anchor="end">(unmodified</text>')
s.append(f'<text x="{L-8}" y="{H-B+90}" font-size="11" fill="{INK2}" text-anchor="end">test files)</text>')
# legend
lx = L + 14; ly = y(560)
s.append(f'<circle cx="{lx+5}" cy="{ly}" r="4.5" fill="{BLUE}"/><text x="{lx+16}" y="{ly+4}" font-size="12" fill="{INK}">reload: false</text>')
s.append(f'<circle cx="{lx+5}" cy="{ly+19}" r="4.5" fill="{ORANGE}"/><text x="{lx+16}" y="{ly+23}" font-size="12" fill="{INK}">reload: true</text>')
s.append('</svg>')
open('/root/verify/pr13323/render/settle.html', 'w').write(f'''<!doctype html><html><head><meta charset="utf-8"><style>body{{margin:0;background:#fff}}#fig{{padding:16px 18px;background:{SURF};width:max-content;border:1px solid {GRID};border-radius:8px;margin:10px}}</style></head><body><div id="fig">{''.join(s)}</div></body></html>''')
print('ok', counts)
