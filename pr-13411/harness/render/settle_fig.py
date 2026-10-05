#!/usr/bin/env python3
"""Fig 3: settle time vs CPU quota (probe), A/B matrix, delay ladder."""
import json, math, html, re, glob, os
R = '/root/verify/pr13411/runs'
BLUE, CRIT, GOOD, GRID, INK, INK2, MUTED, SURF, BAND = '#2a78d6', '#d03b3b', '#0ca30c', '#e1e0d9', '#0b0b0b', '#52514e', '#8a8984', '#fcfcfb', '#f0efec'
FONT = 'Inter,Segoe UI,Helvetica,Arial,sans-serif'
levels = [('idle', f'{R}/probe/idle-cov.jsonl'), ('10%', f'{R}/probe/q10.jsonl'), ('7%', f'{R}/probe/q7.jsonl'), ('5%', f'{R}/probe/q5.jsonl'), ('3%', f'{R}/probe/q3.jsonl'), ('2%', f'{R}/probe/q2.jsonl')]
data = [(lab, sorted(json.loads(l)['settleMs'] for l in open(p))) for lab, p in levels]
W, H, L, Rm, T, B = 600, 380, 70, 170, 46, 50
ymin, ymax = 20, 60000
y = lambda v: T + (H - T - B) * (1 - (math.log10(v) - math.log10(ymin)) / (math.log10(ymax) - math.log10(ymin)))
cx = lambda i: L + (W - L - Rm) * (i + 0.5) / len(data)
s = [f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" font-family="{FONT}">']
s.append(f'<text x="{L-50}" y="18" font-size="14" font-weight="600" fill="{INK}">Settle time of this turn vs CPU quota</text>')
s.append(f'<text x="{L-50}" y="34" font-size="11.5" fill="{INK2}">prompt POST → status settled, 10 ms polls · coverage on · log scale</text>')
for v in (30, 100, 300, 1000, 3000, 10000, 30000):
    yy = y(v); s.append(f'<line x1="{L}" x2="{W-Rm}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{GRID}"/>')
    s.append(f'<text x="{L-6}" y="{yy+4:.1f}" font-size="11" fill="{MUTED}" text-anchor="end">{v/1000:g} s</text>' if v >= 1000 else f'<text x="{L-6}" y="{yy+4:.1f}" font-size="11" fill="{MUTED}" text-anchor="end">{v} ms</text>')
for v, lab in ((1000, 'base window: 1 s'), (10000, 'head window: 10 s')):
    yy = y(v); s.append(f'<line x1="{L}" x2="{W-Rm}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{INK2}" stroke-dasharray="5 3"/>')
    s.append(f'<text x="{W-Rm+6}" y="{yy+4:.1f}" font-size="11" fill="{INK}">{lab}</text>')
for i, (lab, vals) in enumerate(data):
    n = len(vals)
    for j, v in enumerate(vals):
        off = (j - (n - 1) / 2) * (24 / max(n - 1, 1)) if n > 1 else 0
        col = CRIT if v > 10000 else (BLUE)
        s.append(f'<circle cx="{cx(i)+off:.1f}" cy="{y(v):.1f}" r="3.6" fill="{col}" fill-opacity="0.9" stroke="{SURF}" stroke-width="1.2"/>')
    med = vals[n // 2]
    s.append(f'<text x="{cx(i):.1f}" y="{H-B+17}" font-size="11.5" fill="{INK}" text-anchor="middle" font-weight="600">{lab}</text>')
    s.append(f'<text x="{cx(i):.1f}" y="{H-B+31}" font-size="10.5" fill="{MUTED}" text-anchor="middle">n={n}</text>')
s.append(f'<line x1="{L}" x2="{W-Rm}" y1="{H-B}" y2="{H-B}" stroke="{MUTED}"/>')
s.append(f'<text x="{L-50}" y="{H-4}" font-size="10.5" fill="{INK2}">red = above the 10 s window · probe arm repeats the test in one process</text>')
s.append('</svg>')

# A/B table
summ = json.load(open(f'{R}/ab/summary.json'))
by = {(x['arm'], x['quota']): x['runs'] for x in summ}
def cell(runs):
    at = sum(r['attempts'] for r in runs); fa = sum(r['failed'] for r in runs); red = sum(1 for r in runs if not r['passed'])
    cls = 'bad' if red else ('warn' if fa else 'ok')
    icon = '✕' if red else ('↻' if fa else '✓')
    return f'<td class="{cls}">{icon} {red}/{len(runs)} runs red<br><span>{fa}/{at} attempts failed</span></td>'
ab = ''.join(f'<tr><th>{q}%</th>{cell(by[("base", q)])}{cell(by[("head", q)])}</tr>' for q in (10, 7, 5, 3))
abt = f'''<div class="tb"><div class="h">A/B under a dynamic CPU quota</div>
<div class="sub">main-CI settings, <code>--retry=2</code> · unmodified test files, same build · 4 rounds per cell · ↻ = failures absorbed by retry</div>
<table><tr><th>quota</th><th>base (1 s)</th><th>head (10 s)</th></tr>{ab}</table>
<div class="note">Every failed attempt, either arm: <code>expected true to be false</code> on <code>hasActivePrompt</code>; base adds secondary <code>ENOTEMPTY</code> teardown errors — the CI signature.</div></div>'''

# ladder
def lad(arm, d):
    t = open(f'{R}/ladder/{arm}-d{d}.log', errors='replace').read()
    m = re.search(r'([✓×]) Hosted Harness no-tool session > refuses a cold load when a settled file tool outcome is missing from its checkpoint +(\d+)ms', t)
    if not m:
        return '<td class="ok">✓ &lt;300 ms</td>' if 'EXIT=0' in t else '<td>?</td>'
    if m.group(1) == '✓': return f'<td class="ok">✓ {int(m.group(2)):,} ms</td>'
    kind = 'waitFor timeout' if 'vi.waitFor.timeout' in t else 'assertion'
    return f'<td class="bad">✕ {int(m.group(2)):,} ms<br><span>hasActivePrompt {kind}</span></td>'
lrows = ''.join(f'<tr><th>{d if d=="hang" else f"{int(d):,} ms"}</th>{lad("armbaseinj", d)}{lad("armheadinj", d)}</tr>' for d in ('0', '800', '1200', '3000', '9000', '11000', 'hang'))
ladt = f'''<div class="tb"><div class="h">Deterministic delay ladder (no throttle)</div>
<div class="sub">same delay injected into the model call in both arms · no retry · local 15 s test timeout</div>
<table><tr><th>model delay</th><th>base (1 s)</th><th>head (10 s)</th></tr>{lrows}</table>
<div class="note">The head still fails on a turn that never settles (<code>hang</code>) — at ~10.07 s, with the same assertion, not "Test timed out".</div></div>'''
open('/root/verify/pr13411/render/settle.html', 'w').write(f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#fff;font-family:{FONT}}} #fig{{display:flex;gap:26px;padding:18px;background:{SURF};width:max-content;align-items:flex-start}}
.tb{{width:max-content}} .tb .sub,.tb .note{{max-width:390px}} .tb .h{{font-size:14px;font-weight:600;color:{INK};margin:4px 0 4px}} .tb .sub{{font-size:11.5px;color:{INK2};margin-bottom:10px}}
table{{border-collapse:collapse;font-size:12px;color:{INK}}} th{{text-align:left;color:{INK2};font-weight:600;border-bottom:1px solid {GRID};padding:5px 9px;white-space:nowrap}}
td{{padding:5px 9px;border-bottom:1px solid #efeee9;white-space:nowrap;font-variant-numeric:tabular-nums}} td span{{color:{INK2};font-size:11px}}
td.ok{{color:#0a7a0a}} td.bad{{color:{CRIT}}} td.warn{{color:#a86400}} .note{{font-size:11.5px;color:{INK2};margin-top:9px;line-height:1.45}}
code{{font-family:DejaVu Sans Mono,monospace;font-size:10.5px;background:#efeee9;padding:0 3px;border-radius:3px}}
</style></head><body><div id="fig">{"".join(s)}{abt}{ladt}</div></body></html>''')
print('ok')
