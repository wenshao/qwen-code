#!/usr/bin/env python3
"""Fig 1: main-CI census of the target test + neighbour slowdown in the failing run."""
import csv, math, html, re, glob, statistics
C = '/root/verify/pr13411/census'
rows = list(csv.DictReader(open(f'{C}/census.tsv'), delimiter='\t'))
rows.sort(key=lambda r: r['started'])
BLUE, CRIT, GRID, INK, INK2, MUTED, SURF, BAND = '#2a78d6', '#d03b3b', '#e1e0d9', '#0b0b0b', '#52514e', '#8a8984', '#fcfcfb', '#f0efec'
FONT = 'Inter,Segoe UI,Helvetica,Arial,sans-serif'
W, H, L, R, T, B = 620, 340, 66, 18, 44, 56
ymin, ymax = 100, 10000
y = lambda v: T + (H - T - B) * (1 - (math.log10(v) - math.log10(ymin)) / (math.log10(ymax) - math.log10(ymin)))
x = lambda i: L + (W - L - R) * (i + 0.5) / len(rows)
s = [f'<svg width="{W}" height="{H}" xmlns="http://www.w3.org/2000/svg" font-family="{FONT}">']
s.append(f'<text x="{L}" y="18" font-size="14" font-weight="600" fill="{INK}">Target test duration on every main CI run since it was added</text>')
s.append(f'<text x="{L}" y="34" font-size="11.5" fill="{INK2}">{len(rows)} Test (ubuntu-latest, Node 22.x) jobs · {rows[0]["started"][:10]} → {rows[-1]["started"][:10]} · log scale</text>')
s.append(f'<rect x="{L}" y="{y(300):.1f}" width="{W-L-R}" height="{y(100)-y(300):.1f}" fill="{BAND}"/>')
for v in (100, 300, 1000, 3000, 10000):
    yy = y(v); s.append(f'<line x1="{L}" x2="{W-R}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1"/>')
    s.append(f'<text x="{L-6}" y="{yy+4:.1f}" font-size="11" fill="{MUTED}" text-anchor="end">{v:,} ms</text>')
s.append(f'<text x="{W-R-6}" y="{y(135):.1f}" font-size="10.5" fill="{MUTED}" text-anchor="end">vitest omits tests under 300 ms — plotted at 200</text>')
y1s = y(1000); s.append(f'<line x1="{L}" x2="{W-R}" y1="{y1s:.1f}" y2="{y1s:.1f}" stroke="{INK2}" stroke-width="1" stroke-dasharray="4 3"/>')
s.append(f'<text x="{L+6}" y="{y1s-5:.1f}" font-size="10.5" fill="{INK2}">vitest default waitFor window (1 s) — whole-test durations shown, not settle time</text>')
npass = sum(1 for r in rows if r['status'] != 'FAIL'); listed = [int(r['test_ms']) for r in rows if r['status'] == 'pass']
for i, r in enumerate(rows):
    fail = r['status'] == 'FAIL'
    v = int(r['test_ms']) if r['test_ms'] != '-' else 200
    s.append(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="{5.5 if fail else 4}" fill="{CRIT if fail else BLUE}" stroke="{SURF}" stroke-width="2"/>')
    if fail:
        s.append(f'<text x="{x(i)-10:.1f}" y="{y(v)-3:.1f}" font-size="11.5" fill="{INK}" text-anchor="end" font-weight="600">✕ failed all 3 attempts: 5,441 ms cumulative</text>')
        s.append(f'<text x="{x(i)-10:.1f}" y="{y(v)+12:.1f}" font-size="11" fill="{INK2}" text-anchor="end">≈1.8 s per attempt · run 37222299287 · 9915c7ff8f</text>')
s.append(f'<line x1="{L}" x2="{W-R}" y1="{H-B}" y2="{H-B}" stroke="{MUTED}" stroke-width="1"/>')
s.append(f'<text x="{L}" y="{H-B+16}" font-size="11" fill="{MUTED}">{rows[0]["started"][:10]}</text>')
s.append(f'<text x="{W-R}" y="{H-B+16}" font-size="11" fill="{MUTED}" text-anchor="end">{rows[-1]["started"][:10]}</text>')
s.append(f'<text x="{L}" y="{H-14}" font-size="11.5" fill="{INK2}">{npass} passes ({npass-len(listed)} under 300 ms, {len(listed)} listed at 301–{max(listed):,} ms), none needed a retry · 1 failure</text>')
s.append('</svg>')

# panel B: neighbours in failing run
def parse(p):
    d=[]; on=False
    for l in open(p,encoding='utf-8',errors='replace'):
        l=re.sub(r'\x1b\[[0-9;]*m','',l)
        l=l[29:].rstrip('\n') if re.match(r'\d{4}-\d\d-\d\dT',l) else l.rstrip('\n')
        if 'hosted-harness-session.test.ts (' in l: on=True; continue
        if on:
            m=re.match(r'\s+[✓×] (.*?) +(\d+)ms',l)
            if m: d.append((m.group(1),int(m.group(2))))
            elif l.strip().startswith('→'): continue
            else: on=False
    return d
fail = parse(f'{C}/logs/111500825774.log')
idx = [i for i,(n,_) in enumerate(fail) if 'settled file tool outcome' in n][0]
others = [f for f in glob.glob(f'{C}/logs/*.log') if '111500825774' not in f]
seen = {}
for f in others:
    for n, ms in parse(f): seen.setdefault(n, []).append(ms)
trs = []
for n, ms in fail[idx-6:idx+5]:
    b = seen.get(n, [])
    usual = f'&lt;300 ms in {len(others)-len(b)}/{len(others)}' if len(b) < len(others)/2 else f'median {int(statistics.median(b))} ms'
    tgt = 'settled file tool outcome' in n
    nm = html.escape(n.replace('Hosted Harness no-tool session > ', ''))
    trs.append(f'<tr class="{"tgt" if tgt else ""}"><td>{nm}{" <b>(target, 3 attempts)</b>" if tgt else ""}</td><td class="n">{ms:,} ms</td><td class="n m">{usual}</td></tr>')
table = f'''<div class="tb"><div class="h">Same CI run: neighbours in file order were all slowed, not just the target</div>
<div class="sub">run 37222299287 · file took 147,386 ms (median of {len(rows)} jobs: {int(statistics.median(int(r["file_ms"]) for r in rows)):,} ms) · runner load[15.89 18.77 14.46]</div>
<table><tr><th>test</th><th>this run</th><th>usual on main</th></tr>{"".join(trs)}</table></div>'''
open('/root/verify/pr13411/render/census.html','w').write(f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#fff;font-family:{FONT}}} #fig{{display:flex;gap:22px;padding:18px;background:{SURF};width:max-content;align-items:flex-start}}
.tb .h{{font-size:14px;font-weight:600;color:{INK};margin:4px 0 4px}} .tb .sub{{font-size:11.5px;color:{INK2};margin-bottom:10px}}
table{{border-collapse:collapse;font-size:11.5px;color:{INK}}} th{{text-align:left;color:{INK2};font-weight:600;border-bottom:1px solid {GRID};padding:4px 8px}}
td{{padding:3.5px 8px;border-bottom:1px solid #efeee9;max-width:430px}} td.n{{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}} td.m{{color:{INK2}}}
tr.tgt td{{background:#fbeaea}}
</style></head><body><div id="fig">{"".join(s)}{table}</div></body></html>''')
print('ok')
