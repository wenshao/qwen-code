#!/usr/bin/env python3
"""Fig 3: deterministic delay ladder — identical model-call delay in both arms."""
import re, html
D = '/root/verify/pr13323/runs/ladder'
delays = ['0', '800', '1200', '3000', '9000', '11000', 'hang']
GOOD, CRIT, INK, INK2, MUTED, GRID, SURF = '#0ca30c', '#d03b3b', '#0b0b0b', '#52514e', '#8a8984', '#e4e3df', '#fcfcfb'
def cells(arm, d):
    txt = re.sub(r'\x1b\[[0-9;]*m', '', open(f'{D}/{arm}-d{d}.log').read())
    out = {}
    for l in txt.splitlines():
        m = re.match(r'^ +([✓×]) .*\(reload: (true|false)\) *(\d+)?(ms)?', l)
        if m and 'unknown Hook fence' in l:
            out[m.group(2)] = (m.group(1), m.group(3))
    if not out and 'Tests  2 passed' in txt: out = {'false': ('✓', None), 'true': ('✓', None)}
    return out
def td(c):
    ok, ms = c
    msg = f'{int(ms):,} ms' if ms else '< 300 ms'
    if ok == '✓':
        return f'<td><span style="color:{GOOD};font-weight:700">✓</span> pass <span class="ms">{msg}</span></td>'
    return f'<td class="bad"><span style="color:{CRIT};font-weight:700">✕</span> fail <span class="ms">{msg}</span></td>'
rows = []
for d in delays:
    b, h = cells('armbaseinj', d), cells('armheadinj', d)
    lab = 'never (hangs)' if d == 'hang' else f'{int(d):,} ms'
    rows.append(f'<tr><th>{lab}</th>{td(b["false"])}{td(b["true"])}<td class="sep"></td>{td(h["false"])}{td(h["true"])}</tr>')
page = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#fff;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif}}
#fig{{padding:18px 20px;background:{SURF};width:max-content;border:1px solid {GRID};border-radius:8px;margin:10px}}
h1{{font-size:15px;margin:0 0 4px;color:{INK}}} .sub{{font-size:12px;color:{INK2};margin-bottom:12px;max-width:760px;line-height:1.45}}
table{{border-collapse:collapse;font-size:13px;color:{INK}}} th,td{{padding:6px 14px;border-bottom:1px solid {GRID};text-align:left;white-space:nowrap}}
thead th{{font-size:12px;color:{INK2};font-weight:600}} tbody th{{font-weight:600}} td.sep{{width:10px;padding:0;border:none}}
.ms{{color:{MUTED};font-variant-numeric:tabular-nums;margin-left:4px}} td.bad{{background:#fbeaea}}
.grp{{font-size:12.5px;color:{INK};font-weight:700;border-bottom:2px solid {INK2}}}
.foot{{font-size:12px;color:{INK2};margin-top:10px;max-width:760px;line-height:1.45}}
</style></head><body><div id="fig">
<h1>Same injected delay in both arms → only the poll window differs</h1>
<div class="sub">The one model call of the awaited turn is delayed by D ms (or never resolves). Base = merge-base test file, head = PR file; local config (testTimeout 15 s), no retries, no coverage. Durations are vitest's per-test times.</div>
<table><thead><tr><th></th><th colspan="2" class="grp">base 5ddfacc9d4 (1 s default)</th><td class="sep"></td><th colspan="2" class="grp">head 118cc3b (10 s)</th></tr>
<tr><th>model delay D</th><th>reload: false</th><th>reload: true</th><td class="sep"></td><th>reload: false</th><th>reload: true</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<div class="foot">Every failure, in both arms, is the same <code>AssertionError: expected true to be false</code> on <code>hasActivePrompt</code> inside the final <code>vi.waitFor</code>. A turn that never settles still fails on head, at ~10.1 s, with that assertion rather than a test timeout. The change widens the window and does not weaken the check.</div>
</div></body></html>'''
open('/root/verify/pr13323/render/ladder.html', 'w').write(page)
print('ok')
