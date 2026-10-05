#!/usr/bin/env python3
"""Fig 2: requested() settle time (call -> await_action checkpoint visible) vs CPU quota."""
import json, math, random, html
R = '/root/verify/pr13399/runs'
calib = json.load(open(f'{R}/calib.json'))
conds = [('0', 'no throttle'), ('5', '5% CPU'), ('3', '3% CPU'), ('2', '2% CPU'), ('1.5', '1.5% CPU'), ('1', '1% CPU')]
BLUE, GRID, INK, INK2, MUTED, SURF, CRIT = '#2a78d6', '#e4e3df', '#0b0b0b', '#52514e', '#8a8984', '#fcfcfb', '#d03b3b'
W, H, L, Rm, T, B = 1160, 560, 84, 210, 70, 122
ymin, ymax = 30, 30000
ly0, ly1 = math.log10(ymin), math.log10(ymax)
y = lambda v: T + (H - T - B) * (1 - (math.log10(max(v, ymin)) - ly0) / (ly1 - ly0))
bw = (W - L - Rm) / len(conds)
s = [f'<svg id="fig" width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" style="background:{SURF}">',
     f'<rect width="{W}" height="{H}" fill="{SURF}"/>',
     f'<text x="{L}" y="24" font-size="16" font-weight="600" fill="{INK}">How long requested() has to wait, by CPU available to the test</text>',
     f'<text x="{L}" y="44" font-size="12" fill="{INK2}">PR head, main-CI config (coverage on). One dot = one requested() call: time until the Action is requested AND the await_action checkpoint is visible.</text>',
     f'<text x="{L}" y="60" font-size="12" fill="{INK2}">All 34 calls in the file per condition, polled every 50 ms (vi.waitFor\'s own interval). Log scale.</text>']
for v in (30, 100, 300, 1000, 3000, 10000, 30000):
    yy = y(v)
    s.append(f'<line x1="{L}" x2="{W-Rm}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{GRID}"/>')
    s.append(f'<text x="{L-8}" y="{yy+4:.1f}" font-size="11.5" fill="{MUTED}" text-anchor="end">{v/1000:g} s</text>')
for v, lab, sub in ((1000, '1 s', 'vitest default (before #13380)'), (5000, '5 s', 'timeout: 5_000 (main)'), (10000, '10 s', 'timeout: 10_000 (this PR)')):
    yy = y(v)
    s.append(f'<line x1="{L}" x2="{W-Rm+6}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{INK}" stroke-width="1.5" stroke-dasharray="{"" if v == 10000 else "5 3"}"/>')
    s.append(f'<text x="{W-Rm+12}" y="{yy-1:.1f}" font-size="12.5" font-weight="700" fill="{INK}">{lab} budget</text>')
    s.append(f'<text x="{W-Rm+12}" y="{yy+14:.1f}" font-size="11" fill="{INK2}">{html.escape(sub)}</text>')
random.seed(11)
for i, (q, lab) in enumerate(conds):
    cx = L + bw * (i + 0.5)
    rows = [json.loads(l) for l in open(f'{R}/probe/q{q}-r1.jsonl')]
    v = sorted(r['ckptMs'] for r in rows)
    for t in v:
        off = random.uniform(-bw * 0.22, bw * 0.22)
        s.append(f'<circle cx="{cx+off:.1f}" cy="{y(t):.1f}" r="4.2" fill="{BLUE}" fill-opacity="0.85" stroke="{SURF}" stroke-width="1.5"/>')
    med = v[len(v)//2]
    s.append(f'<line x1="{cx-bw*0.3:.1f}" x2="{cx+bw*0.3:.1f}" y1="{y(med):.1f}" y2="{y(med):.1f}" stroke="{INK}" stroke-width="2.5"/>')
    s.append(f'<text x="{cx:.1f}" y="{H-B+20}" font-size="12.5" font-weight="600" fill="{INK}" text-anchor="middle">{lab}</text>')
    over5 = sum(t > 5000 for t in v); over10 = sum(t > 10000 for t in v)
    s.append(f'<text x="{cx:.1f}" y="{H-B+37}" font-size="11" fill="{INK2}" text-anchor="middle">median {med/1000:.2f} s · max {v[-1]/1000:.1f} s</text>')
    s.append(f'<text x="{cx:.1f}" y="{H-B+53}" font-size="11" fill="{INK2 if over5 == 0 else CRIT}" text-anchor="middle">over 5 s: {over5}/34</text>')
    s.append(f'<text x="{cx:.1f}" y="{H-B+68}" font-size="11" fill="{INK2 if over10 == 0 else CRIT}" text-anchor="middle">over 10 s: {over10}/34</text>')
    if q == '5':
        s.append(f'<rect x="{cx-bw*0.48:.1f}" y="{T+2}" width="{bw*0.96:.1f}" height="34" rx="4" fill="#f0efec"/>')
        s.append(f'<text x="{cx:.1f}" y="{T+16}" font-size="10.5" fill="{INK2}" text-anchor="middle">the failing CI run was lighter</text>')
        s.append(f'<text x="{cx:.1f}" y="{T+30}" font-size="10.5" fill="{INK2}" text-anchor="middle">than this (ratio {calib["5"]["median_ratio"]:.2f})</text>')
s.append(f'<line x1="{L}" x2="{L+20}" y1="{H-30}" y2="{H-30}" stroke="{INK}" stroke-width="2.5"/>')
s.append(f'<text x="{L+26}" y="{H-26}" font-size="11" fill="{INK2}">median. Calibration box: per-test durations of the 33 approval tests that passed in the failing CI job 111443483838, divided by the same tests here,</text>')
s.append(f'<text x="{L+26}" y="{H-11}" font-size="11" fill="{INK2}">give a median ratio of 0.63 at 5% CPU (0.35 at 3%, 0.21 at 2%). On average that CI run was less starved than this 5% column; only the failing test hit a burst.</text>')
s.append('</svg>')
open('fig2.html', 'w').write('<!doctype html><html><body style="margin:0;background:#fcfcfb">' + '\n'.join(s) + '</body></html>')
