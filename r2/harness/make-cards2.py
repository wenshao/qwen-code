#!/usr/bin/env python3
"""Render the PR #12250 round-2 evidence cards (HTML -> PNG via headless Chrome)."""
import html, json, pathlib, re, subprocess, sys
from PIL import Image, ImageChops

HERE = pathlib.Path(__file__).parent
SP = HERE.parent
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

CSS = """
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
.card{padding:26px 30px 30px;width:1340px}
h1{font-size:21px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13.5px;margin:0 0 14px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}
th,td{border:1px solid #30363d;padding:7px 10px;vertical-align:top;text-align:left}
th{background:#161b22;color:#c9d1d9;font-weight:600;font-size:13.5px}
td{font-size:13.5px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#161b22;padding:1px 4px;border-radius:4px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:3px solid #58a6ff;padding:6px 12px;margin:10px 0 0;color:#c9d1d9;font-size:13.5px;background:#0f1a2a}
.note.red{border-color:#f85149;background:#1f1215}
h2{font-size:16px;margin:18px 0 6px}
pre.term{background:#010409;border:1px solid #30363d;border-radius:6px;padding:10px 14px;font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9;margin:6px 0 4px;white-space:pre}
.t-red{color:#f85149}.t-green{color:#3fb950}.t-dim{color:#6e7681}.t-cyan{color:#39c5cf}.t-bgred{background:#da3633;color:#fff;font-weight:700;padding:0 4px}
.tl{position:relative;height:30px;background:#161b22;border:1px solid #30363d;border-radius:4px;margin:4px 0 2px}
.tl .seg{position:absolute;top:4px;height:20px;border-radius:3px;font-size:11.5px;line-height:20px;padding-left:5px;overflow:hidden;white-space:nowrap;color:#0d1117;font-weight:600}
.tl .turn{background:#1f6feb55;border:1px solid #388bfd;color:#c9d1d9;top:1px;height:26px;line-height:26px}
.tl .probe{background:#d29922;}
.tl .mark{position:absolute;top:-2px;height:32px;width:2px}
.lbl{font-size:12.5px;color:#c9d1d9;margin-top:10px}
.axis{position:relative;height:16px;font-size:11px;color:#8b949e}
.axis span{position:absolute;transform:translateX(-50%)}
"""


def page(body):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="card">{body}</div></body></html>'


def render(name, body, height=2000):
    src = HERE / f'{name}.html'
    src.write_text(page(body))
    raw = HERE / f'{name}.raw.png'
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=2', f'--window-size=1400,{height}',
                    f'--screenshot={raw}', f'file://{src}'], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    im = Image.open(raw).convert('RGB')
    bg = Image.new('RGB', im.size, (13, 17, 23))
    bbox = ImageChops.difference(im, bg).getbbox()
    im = im.crop((0, 0, im.width, min(im.height, bbox[3] + 40)))
    im.save(HERE / f'{name}.png', optimize=True)
    raw.unlink()
    print(name, im.size)


def ansi_to_html(text):
    out = []
    cls = []
    pos = 0
    for m in re.finditer(r'\x1b\[([0-9;]*)m', text):
        out.append(html.escape(text[pos:m.start()]))
        pos = m.end()
        codes = [c for c in m.group(1).split(';') if c]
        if out and cls:
            out.append('</span>')
        cls = []
        for c in codes:
            cls.append({'31': 't-red', '32': 't-green', '90': 't-dim', '36': 't-cyan', '41': 't-bgred', '2': 't-dim'}.get(c, ''))
        cls = [c for c in cls if c]
        if cls:
            out.append(f'<span class="{" ".join(cls)}">')
    out.append(html.escape(text[pos:]))
    if cls:
        out.append('</span>')
    return ''.join(out)


# ---------------------------------------------------------------- figure 4
log = (SP / 'out/pretty-new-M10.log').read_text()
start = log.index(' FAIL ')
start = log.rfind('\n', 0, start) + 1
end = log.index('[1/1]', start)
end = log.index('\n', end)
term = ansi_to_html(log[start:end]).replace('⎯', '-')

def res(v):
    return v

rows = [
    # (scenario, prev result, new result, meaning)
    ('Production intact', '<span class="ok">pass</span>', '<span class="ok">pass</span>', 'both versions green on the unmutated code'),
    ('<b>M10</b>: <code>!!entry.backgroundTurn</code> removed from <code>entryHasLocalWork</code>',
     '<span class="bad">fail</span> <code>:609</code> <code>sessionCount</code> — the counter at <code>:608</code> still reads 0',
     '<span class="bad">fail</span> <code>:612</code> <code>conditionalCloseCalls</code> <b>0 → 1</b>',
     'the counter can now fail: the daemon asks the child to close a session whose background turn it knows is running'),
    ('<b>M12</b>: <code>end_turn</code> no longer clears <code>entry.backgroundTurn</code>',
     '<span class="warn">pass</span> (not caught)',
     '<span class="bad">fail</span> <code>:621</code> positive control — the session never goes',
     'this test now also checks the release direction (at package level, 6 existing tests already catch M12, see the matrix)'),
    ('Fixture drift: an event subscriber attached before detaching (code intact)',
     '<span class="warn">pass</span> — and still passes under M10 (masked)',
     '<span class="bad">fail</span> <code>:627</code> positive control',
     'the drift the bot withdrew in its last round is real for the previous version; the control now turns it red'),
    ('Without the fresh empty snapshot (<code>nosnap</code>), under M10', '—',
     '<span class="bad">fail</span> at the counter',
     'the snapshot is not load-bearing today; it keeps the fixture in the "child reports idle" state'),
    ('Reaper off (<code>sessionReapIntervalMs: 0</code>), under M10', '<span class="bad">fail</span> (R1)',
     '<span class="bad">fail</span> <code>:612</code> counter',
     'retention is decided on the detach path'),
    ('Reaper off, code intact', '<span class="ok">pass</span>',
     '<span class="bad">fail</span> <code>:621</code> positive control',
     'the release after <code>end_turn</code> is done by the reaper (no settle-driven close; M13 removing the settle hook stays green)'),
]
trs = ''.join(f'<tr><td>{a}</td><td>{b}</td><td>{c}</td><td class="dim">{d}</td></tr>' for a, b, c, d in rows)
fig4 = f"""
<h1>The retention test, before and after <code>02665c2cf7</code>: the counter is live and the new control pins the release</h1>
<p class="sub">Only <code>retains a detached session whose only work is an admitted background turn</code> was run, with the production code identical in both columns.
<b>previous</b> = the test at <code>301dbdbeea</code> (non-negotiating fixture, no control). <b>new</b> = the test at <code>02665c2cf7</code> (full active-work capability negotiated, a fresh empty snapshot before detaching, and an <code>end_turn</code> positive control).
Each cell is one vitest run. A hash of the source files under test was recorded for every run, to prove each mutant and variant was actually applied.</p>
<table><tr><th style="width:27%">Scenario</th><th style="width:21%">previous test</th><th style="width:22%">new test</th><th>What it shows</th></tr>{trs}</table>
<h2>The real failure under M10 at the new head</h2>
<pre class="term">{term}</pre>
<div class="note">Flakiness: the new test passed <b>20 / 20</b> runs with 8 CPU-burning processes pinned alongside (load average 35 → 120).</div>
"""
render('fig4-retention-test', fig4)

# ---------------------------------------------------------------- figure 5
tl = {json.loads(l)['run']: json.loads(l) for l in (SP / 'rig/out/timelines.jsonl').read_text().splitlines()}
SCALE = 30.0
W = 1280

def x(t):
    return min(max(t, 0), SCALE) / SCALE * 100

def timeline(run, title):
    d = tl[run]
    segs = [f'<div class="seg turn" style="left:{x(d["admitted"])}%;width:{x(d["turnEnd"]) - x(d["admitted"])}%">background turn (silent 20 s shell)</div>']
    ev = d['ev']
    sends = [e for e in ev if e['k'] == 'send']
    for s in sends:
        endt = next((e['t'] for e in ev if e['k'] in ('timeout', 'answer') and e['t'] > s['t']), s['t'] + 8)
        segs.append(f'<div class="seg probe" style="left:{x(s["t"])}%;width:{x(endt) - x(s["t"])}%;top:6px;height:16px;line-height:16px">conditional close in flight</div>')
    marks = [f'<div class="mark" style="left:{x(d["detach"])}%;background:#8b949e" title="detach"></div>']
    for e in ev:
        if e['k'] == 'load':
            col = '#3fb950' if e['status'] == '200' else '#f85149'
            marks.append(f'<div class="mark" style="left:{x(e["t"])}%;background:{col};width:3px"></div>')
    loads = ', '.join(f'<span class="{"ok" if e["status"]=="200" else "bad"}">re-attach {e["status"]}{" session_closing" if e["status"]=="404" else ""}</span> at +{e["t"]:.1f}s' for e in ev if e['k'] == 'load')
    gone = d['gone'] if d['gone'] is not None else next((e['t'] for e in ev if e['k'] == 'answer' and e['t'] > 30), None)
    tail = f' · session closed at +{gone:.1f}s' if gone else ''
    if gone and gone > SCALE:
        tail = f' · <span class="bad">session closed at +{gone:.1f}s</span> (two timed-out probes → next probe deferred 60 s)'
    return f'<div class="lbl"><b>{title}</b> · detach at +{d["detach"]:.1f}s · {loads}{tail}</div><div class="tl">{"".join(segs)}{"".join(marks)}</div>'

axis = '<div class="axis">' + ''.join(f'<span style="left:{t / SCALE * 100}%">{t}s</span>' for t in range(0, 31, 5)) + '</div>'
fig5 = f"""
<h1>Real stack at <code>02665c2cf7</code>: what the retention pin corresponds to on a negotiated child</h1>
<p class="sub">Real <code>qwen serve</code> (bundle built at the new head), real ACP child, scripted model, reaper 500 ms / idle 1 s. The session's only client detaches while the automatic background-notification turn runs.
<b>HEAD</b> = the head bundle plus observation-only stderr lines. <b>MUT</b> = the same with the 7 pinned <code>backgroundTurn</code> terms off.
<b>no-holds child</b> = one extra bundle line, <code>if (this.backgroundTurn) return [];</code> at the top of the child's <code>collectActiveWorkHolds()</code>. That reproduces the state the new fixture models: active-work negotiated, the child reporting no holds, and a background turn admitted.</p>
<table>
<tr><th style="width:21%"></th><th style="width:37%">HEAD</th><th>MUT — terms off</th></tr>
<tr><td><b>Today's child</b><br><span class="dim">reports a hold for every notification kind: agent/workflow → <code>notification</code>, shell → <code>shell</code>, monitor → <code>session</code></span></td>
<td><span class="ok">0</span> conditional closes during the turn (every auto-close check stops at <code>entryHasLocalWork</code>) · re-attach <span class="ok">200</span> · closed as the turn ends</td>
<td><span class="ok">0</span> conditional closes during the turn — <b>{tl['mut-retain-r1']['checksWithHold']}/{tl['mut-retain-r1']['checksDuringTurn']}</b> checks stopped by the child's <code>notification</code> hold · re-attach <span class="ok">200</span> · closed as the turn ends</td></tr>
<tr><td><b>No-holds child</b><br><span class="dim">the new fixture's state</span></td>
<td><span class="ok">0</span> conditional closes during the turn in <b>6/6</b> runs · re-attach <span class="ok">200</span> in <b>5/5</b> · closed shortly after the turn ends</td>
<td><span class="bad">1–2</span> conditional closes during the turn in <b>6/6</b> runs, each holding the session in <i>closing</i> for up to the 8 s drain budget · re-attach inside that window <span class="bad">404 <code>session_closing</code></span> in <b>3/3</b> · in 1 run, two timeouts deferred the next probe by 60 s and the session outlived its turn by 58 s</td></tr>
</table>
{axis}
{timeline('obs-ur-retainw-w1', 'HEAD · no-holds child · run w1')}
{timeline('mut-ur-retainw-w1', 'MUT · no-holds child · run w1')}
{timeline('mut-ur-retainw-w3', 'MUT · no-holds child · run w3')}
{axis}
<div class="note">Re-attach = <code>POST /session/:id/load</code> sent 0.5 s after the daemon logged a conditional close for the session (or 12 s after detach if none was sent). MUT's 404 body: <code>No session with id "…". The session is closing; retry after close completes</code>.</div>
<div class="note red"><b>Reading:</b> with today's child, the <code>entryHasLocalWork</code> term is masked by the child's own hold. That is why the new test negotiates and then reports an empty hold set: it pins the daemon-owned rule itself, as the function's doc comment describes. If the report is ever empty while the daemon knows a turn is running, this term is what stands between a running background turn and the mid-turn close probes, the refused re-attaches, and the deferred cleanup shown above.</div>
"""
render('fig5-real-stack-r2', fig5)
