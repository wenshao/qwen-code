#!/usr/bin/env python3
"""Fig 1: main-CI census of the target test + per-test slowdown in the failing run."""
import csv, json, math, html
C = '/root/verify/pr13323/census'
rows = list(csv.DictReader(open(f'{C}/census.tsv'), delimiter='\t'))
rows.sort(key=lambda r: r['created'])
slow = json.load(open(f'{C}/slowdown.json'))
for r in slow:  # reload:true ran 3 attempts (retry x2): compare per attempt
    if 'unknown Hook fence (reload: true)' in r['name']:
        r['ratio'] = round(r['fail'] / 3 / r['normal'], 2)
slow.sort(key=lambda r: r['ratio'])

BLUE, CRIT, GRID, INK, INK2, MUTED, SURF = '#2a78d6', '#d03b3b', '#e4e3df', '#0b0b0b', '#52514e', '#8a8984', '#fcfcfb'
# ---- panel A: duration of reload:true per run (log y) ----
W, H, L, R, T, B = 560, 330, 64, 16, 40, 54
ymin, ymax = 100, 30000
y = lambda v: T + (H - T - B) * (1 - (math.log10(v) - math.log10(ymin)) / (math.log10(ymax) - math.log10(ymin)))
x = lambda i: L + (W - L - R) * (i + 0.5) / len(rows)
svgA = [f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif">']
svgA.append(f'<text x="{L}" y="18" font-size="14" font-weight="600" fill="{INK}">reload: true — test duration on each main CI run</text>')
svgA.append(f'<text x="{L}" y="33" font-size="11.5" fill="{INK2}">52 Test (ubuntu-latest) jobs, 2026-10-02 → 10-04 · log scale</text>')
for v in (100, 300, 1000, 3000, 10000, 30000):
    yy = y(v); svgA.append(f'<line x1="{L}" x2="{W-R}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1"/>')
    svgA.append(f'<text x="{L-6}" y="{yy+4:.1f}" font-size="11" fill="{MUTED}" text-anchor="end">{v:,} ms</text>')
# band for "not listed" (<300ms)
svgA.append(f'<rect x="{L}" y="{y(300):.1f}" width="{W-L-R}" height="{y(100)-y(300):.1f}" fill="#f0efec"/>')
svgA.append(f'<text x="{W-R-6}" y="{y(140):.1f}" font-size="10.5" fill="{MUTED}" text-anchor="end">vitest omits tests under 300 ms — plotted at 200</text>')
for i, r in enumerate(rows):
    fail = 'FAIL' in r['true_status']
    v = int(r['true_ms'][:-2]) if r['true_ms'] != '-' else 200
    col = CRIT if fail else BLUE
    svgA.append(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="{5 if fail else 4}" fill="{col}" stroke="{SURF}" stroke-width="2"/>')
    if fail:
        svgA.append(f'<text x="{x(i)-10:.1f}" y="{y(v)-2:.1f}" font-size="11.5" fill="{INK}" text-anchor="end" font-weight="600">✕ failed: 18,884 ms over 3 attempts</text>')
        svgA.append(f'<text x="{x(i)-10:.1f}" y="{y(v)+13:.1f}" font-size="11" fill="{INK2}" text-anchor="end">run 37133512121 · 691a374d2a</text>')
svgA.append(f'<line x1="{L}" x2="{W-R}" y1="{H-B}" y2="{H-B}" stroke="{MUTED}" stroke-width="1"/>')
svgA.append(f'<text x="{L}" y="{H-B+16}" font-size="11" fill="{MUTED}">{rows[0]["created"][:10]}</text>')
svgA.append(f'<text x="{W-R}" y="{H-B+16}" font-size="11" fill="{MUTED}" text-anchor="end">{rows[-1]["created"][:10]}</text>')
svgA.append(f'<text x="{L}" y="{H-14}" font-size="11.5" fill="{INK2}">51 passes, all ≤ 415 ms, none needed a retry · 1 failure</text>')
svgA.append('</svg>')

# ---- panel B: slowdown ratio per test, failing run vs 5ddfacc9d4 run ----
bw, rowh, LB, RB, TB = 600, 10.5, 20, 230, 44
HB = int(TB + rowh * len(slow) + 46)
xmax = 50
xb = lambda v: LB + (bw - LB - RB) * math.log10(v) / math.log10(xmax)
svgB = [f'<svg width="{bw}" height="{HB}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif">']
svgB.append(f'<text x="{LB}" y="18" font-size="14" font-weight="600" fill="{INK}">Same file, failing run vs a normal run — slowdown per test</text>')
svgB.append(f'<text x="{LB}" y="33" font-size="11.5" fill="{INK2}">run 37133512121 vs run on 5ddfacc9d4 · 29 tests listed in both · log scale</text>')
for v in (1, 2, 5, 10, 20, 50):
    xx = xb(v); svgB.append(f'<line x1="{xx:.1f}" x2="{xx:.1f}" y1="{TB}" y2="{TB+rowh*len(slow)}" stroke="{GRID}" stroke-width="1"/>')
    svgB.append(f'<text x="{xx:.1f}" y="{TB+rowh*len(slow)+14}" font-size="11" fill="{MUTED}" text-anchor="middle">{v}×</text>')
for i, r in enumerate(slow):
    yy = TB + i * rowh + 1
    tgt = 'unknown Hook fence' in r['name']
    col = CRIT if tgt and 'true' in r['name'] else (BLUE if not tgt else '#256abf')
    w = max(1.5, xb(r['ratio']) - LB)
    svgB.append(f'<rect x="{LB}" y="{yy:.1f}" width="{w:.1f}" height="{rowh-2.5:.1f}" rx="2" fill="{col}" opacity="{1 if tgt else 0.55}"/>')
    if tgt:
        lab = 'reload: true, per attempt (failed ×3)' if 'true' in r['name'] else 'reload: false (passed)'
        svgB.append(f'<text x="{LB+w+5:.1f}" y="{yy+rowh-3:.1f}" font-size="11" fill="{INK}" font-weight="600">{r["ratio"]:.1f}× {lab}</text>')
med = sorted(r['ratio'] for r in slow)[len(slow)//2]
svgB.append(f'<line x1="{xb(med):.1f}" x2="{xb(med):.1f}" y1="{TB}" y2="{TB+rowh*len(slow)}" stroke="{INK2}" stroke-width="1.5"/>')
svgB.append(f'<text x="{xb(med)+4:.1f}" y="{TB+9}" font-size="11" fill="{INK2}">median {med:.1f}×</text>')
svgB.append(f'<text x="{LB}" y="{HB-8}" font-size="11.5" fill="{INK2}">The tests that ran just before it slowed 8–21×; both variants of this test slowed the same 16.5×</text>')
svgB.append('</svg>')

page = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#fff}} #fig{{display:flex;gap:28px;padding:18px 20px;background:{SURF};width:max-content;border:1px solid {GRID};border-radius:8px;margin:10px}}
</style></head><body><div id="fig">{''.join(svgA)}{''.join(svgB)}</div></body></html>'''
open('/root/verify/pr13323/render/census.html', 'w').write(page)
print('ok', len(rows), len(slow))
