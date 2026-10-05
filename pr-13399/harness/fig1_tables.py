#!/usr/bin/env python3
"""Fig 1: deterministic delay ladder + real CPU-contention A/B, three arms."""
import json, re, glob, html
L = '/root/verify/pr13399/runs/ladder'
ab = json.load(open('/root/verify/pr13399/runs/ab.json'))
arms = [('armoriginj', 'orig', '1 s', 'vitest default<br>(before #13380)'),
        ('armmaininj', 'main', '5 s', '<code>timeout: 5_000</code><br>(main today)'),
        ('armheadinj', 'head', '10 s', '<code>timeout: 10_000</code><br>(this PR)')]
GOOD, CRIT, INK, INK2, MUTED, GRID, SURF = '#0ca30c', '#d03b3b', '#0b0b0b', '#52514e', '#8a8984', '#e4e3df', '#fcfcfb'
def cell(ok, main, sub=''):
    col = GOOD if ok else CRIT
    icon = '✓' if ok else '✕'
    word = 'pass' if ok else 'fail'
    return f'<td><span class="ic" style="color:{col}">{icon}</span> <b>{word}</b> <span class="v">{main}</span>{f"<div class=sub>{sub}</div>" if sub else ""}</td>'
rows = []
for d, lab in [('0', 'none'), ('800', '0.8 s'), ('2000', '2 s'), ('4000', '4 s'), ('6000', '6 s'), ('9000', '9 s'), ('11000', '11 s'), ('hang', 'never (hang)')]:
    tds = []
    for f, _, _, _ in arms:
        t = re.sub(r'\x1b\[[0-9;]*m', '', open(f'{L}/{f}-d{d}.log').read())
        m = re.search(r'^\s+([✓×]) reports an answer that loses the race to the expiry as expired\s+(\d+)ms', t, re.M)
        ok = 'EXIT=0' in t
        ms = int(m.group(2)) if m else None
        tds.append(cell(ok, f'{ms/1000:.2f} s' if ms else ''))
    rows.append(f'<tr><th>{lab}</th>{"".join(tds)}</tr>')
rows2 = []
for q in ['3', '2', '1.5', '1']:
    tds = []
    for _, k, _, _ in arms:
        rs = ab[f'{k}|{q}']
        fails = sum(r['status'] == 'fail' for r in rs)
        fa = sum((r['retries'] + 1) if r['status'] == 'fail' else r['retries'] for r in rs)
        at = sum(r['retries'] + 1 for r in rs)
        tds.append(cell(fails == 0, f'{fails}/{len(rs)} runs failed', f'{fa} of {at} attempts failed'))
    rows2.append(f'<tr><th>{q}% CPU</th>{"".join(tds)}</tr>')
head = ''.join(f'<th class="arm"><div class="big">{b}</div><div class="sub">{c}</div></th>' for _, _, b, c in arms)
page = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:{SURF};font-family:Inter,"Segoe UI",Helvetica,Arial,sans-serif;color:{INK}}}
#fig{{padding:22px 26px 18px;background:{SURF};width:max-content}}
h1{{font-size:17px;margin:0 0 4px}} .lead{{font-size:13px;color:{INK2};margin:0 0 16px;max-width:1120px;line-height:1.45}}
.pan{{display:flex;gap:28px;align-items:flex-start}}
.box h2{{font-size:14px;margin:0 0 3px}} .box p{{font-size:12px;color:{INK2};margin:0 0 10px;max-width:540px;line-height:1.4}}
table{{border-collapse:collapse;font-size:13px}}
th,td{{border-bottom:1px solid {GRID};padding:7px 12px;text-align:left;vertical-align:top}}
th{{font-weight:600;color:{INK2};white-space:nowrap}} th.arm{{color:{INK}}}
.big{{font-size:15px;font-weight:700}} .sub{{font-size:11.5px;color:{MUTED};font-weight:400;margin-top:2px}}
code{{font-family:"DejaVu Sans Mono",monospace;font-size:11px}}
.ic{{font-weight:800}} .v{{color:{INK2};margin-left:4px}}
.note{{font-size:11.5px;color:{MUTED};margin-top:12px;max-width:1120px;line-height:1.45}}
</style></head><body><div id="fig">
<h1>The CI-failing test, one build, three <code style="font-size:14px">requested()</code> budgets</h1>
<p class="lead">Test: <i>reports an answer that loses the race to the expiry as expired</i> (#13397). Each arm runs an untracked sibling copy of the test file: the exact blob before #13380, the exact blob on main today, and the PR head. Every failure, in both panels, is the <code>vi.waitFor</code> assertion inside <code>requested()</code>. None is a test timeout.</p>
<div class="pan">
<div class="box"><h2>A · Deterministic delay in the failure window</h2>
<p>The same one-shot hold is injected into all three arms, after <code>requestToolAction</code> commits and before the <code>await_action</code> checkpoint commit. Local config, no retry. Value = test duration.</p>
<table><tr><th>hold</th>{head}</tr>{"".join(rows)}</table></div>
<div class="box"><h2>B · Real CPU starvation, unmodified files</h2>
<p>Main-CI config (coverage on, 60 s test timeout, <code>--retry=2</code>). A transient cgroup <code>CPUQuota</code> is applied after collection. 4 runs per cell, all 12 arms of a round in parallel.</p>
<table><tr><th>quota</th>{head}</tr>{"".join(rows2)}</table></div>
</div>
<div class="note">Failure signatures: A always shows <code>expected 'before_model' to be 'await_action'</code>, the exact #13397 assertion. B shows that assertion and the length check three lines above it (<code>expected [] to have a length of 1</code>), both inside the same <code>vi.waitFor</code> callback. On the hang row each arm fails at its own budget (1.06 / 5.04 / 10.06 s): a stuck turn still fails, with the same assertion.</div>
</div></body></html>'''
open('fig1.html', 'w').write(page)
