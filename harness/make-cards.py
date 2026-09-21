#!/usr/bin/env python3
"""Render the PR #12250 evidence cards (HTML -> PNG via headless Chrome)."""
import html, pathlib, subprocess
from PIL import Image, ImageChops

HERE = pathlib.Path(__file__).parent
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

CSS = """
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
.card{padding:26px 30px 30px;width:1340px}
h1{font-size:21px;margin:0 0 4px}
.sub{color:#8b949e;font-size:13.5px;margin:0 0 16px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}
th,td{border:1px solid #30363d;padding:7px 10px;vertical-align:top;text-align:left}
th{background:#161b22;color:#c9d1d9;font-weight:600;font-size:13.5px}
td{font-size:13.5px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#161b22;padding:1px 4px;border-radius:4px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:3px solid #58a6ff;padding:6px 12px;margin:10px 0 0;color:#c9d1d9;font-size:13.5px;background:#0f1a2a}
.note.red{border-color:#f85149;background:#1f1215}
h2{font-size:16px;margin:18px 0 6px}
"""


def page(body):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="card">{body}</div></body></html>'


def render(name, body, height=1800):
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


# ---------------------------------------------------------------- figure 1
fig1 = """
<h1>Real <code>qwen serve</code> + real ACP child: one real background-notification turn, two bundles</h1>
<p class="sub">macOS 25.6 · Node 24.18.1 · PR head <code>171e1b17fc</code> built with <code>npm run build &amp;&amp; npm run bundle</code> ·
scripted OpenAI-compatible model · parent launches one background agent → it finishes → the child admits
<code>_qwencode/start_turn</code> (<code>source: background_notification</code>) → that turn runs a silent 20&nbsp;s shell. Every request below is sent inside that window.<br>
<b>HEAD</b> = the PR-head bundle (this PR changes no production code, so this is also <code>main</code>'s behaviour).
<b>MUT</b> = the same bundle with the 7 <code>backgroundTurn</code> terms this PR pins turned off (7 lines in one chunk).
"Dispatched" comes from a <code>[probe-dispatch]</code> stderr line placed right before the bridge sends each operation to the child: MUT carries it, and so does an otherwise untouched HEAD twin, which gave the same HTTP answers and logged 0 dispatches inside the window.</p>
<table>
<tr><th style="width:22%">Inside the window</th><th style="width:36%">HEAD — guards intact</th><th>MUT — the 7 pinned terms off</th></tr>
<tr><td><code>POST /session/:id/branch</code></td>
<td><span class="ok">409</span> <code>branch_while_prompt_active</code> · 4 ms · not dispatched</td>
<td><span class="warn">409</span> <code>session_busy</code> · 18 ms · <b>dispatched</b>; the child's own check refused ("Cannot branch while a prompt is running") — error code changes</td></tr>
<tr><td><code>POST /session/:id/rewind</code></td>
<td><span class="ok">409</span> <code>session_busy</code> · 8 ms · not dispatched</td>
<td><span class="warn">409</span> <code>session_busy</code> · 16 ms · <b>dispatched</b>; the child's <code>isTurnIdle()</code> refused — same answer, one layer later</td></tr>
<tr><td><code>POST /session/:id/fork</code></td>
<td><span class="ok">409</span> <code>session_busy</code> · 4 ms · not dispatched</td>
<td><span class="bad">202 launched</span> · 6 ms · the forked worker's first model request went out <b>0.8 s into the background turn's 20 s shell</b> — two agents running in one session</td></tr>
<tr><td><code>POST /session/:id/cd</code></td>
<td><span class="ok">409</span> <code>cd_while_prompt_active</code> · 2–7 ms · not dispatched</td>
<td><span class="bad">200 after 21.1 s</span> · dispatched; the child held it until the background turn ended, then moved the cwd to <code>ws/sub</code></td></tr>
<tr><td>detach the only client<br><span class="dim">reaper 500 ms · idle 1 s · no SSE subscriber</span></td>
<td><span class="ok">kept 20.6 s</span>, closed the moment the turn ended (<code>last_client_detached</code>)</td>
<td><span class="ok">kept too</span> — the child's active-work heartbeat reported hold <code>notification</code> on <b>43 / 43</b> candidate checks; closed after the turn via <code>close-if-unheld → closed:true</code></td></tr>
</table>
<div class="note"><b>Control, same session after the turn</b> (both arms): <code>cd</code> 200 · <code>cd</code> back 200 · <code>branch</code> 201 · <code>rewind</code> 400 <code>invalid_rewind_target</code> (got past the busy check to the child's snapshot lookup) · <code>fork</code> 202. So every 409 above is the background turn and nothing else.</div>
<div class="note"><b>R1-14 on the wire.</b> A mid-turn message sent in the window is accepted and its <code>mid_turn_message_injected</code> frame carries the background <code>turnId</code>.
Across 3 sessions, all <b>8 / 8</b> drains the child made during background turns sent <code>promptId</code> = that <code>turnId</code> <b>explicitly</b>, 0 omitted it (<code>[probe-drain]</code> log) — the
"<code>promptId</code> omitted" fallback the new drain test pins is a compatibility path the current child does not take.</div>
<div class="note red"><b>What the pins protect in practice:</b> for <code>fork</code> and <code>cd</code> the daemon guard is the only barrier (MUT: concurrent fork agent; a 21 s hang that then silently applies).
For <code>branch</code>/<code>rewind</code> and session retention, the child has its own check, so the daemon term is defence in depth. In the Web Shell, <code>/fork</code> never got this far: its composer refuses slash commands while a turn runs (figure 3). The guards mainly face direct HTTP and SDK <code>DaemonClient</code> callers.</div>
"""
render('fig1-real-daemon-ab', fig1)

# ---------------------------------------------------------------- figure 2
rows = [
    ('M1', 'drop the middle term of <code>currentTurnMetadata</code> <span class="dim">bridgeClient.ts:767</span>', '<span class="warn">1 red</span> <span class="dim">(pre-existing terminal-sequence test)</span>', '<span class="ok">2 red</span>', '+ <i>drains with the background turn id when promptId is omitted</i>'),
    ('M1b', 'same, at the drain call site only <span class="dim">bridgeClient.ts:1559</span>', 'survives', '<span class="ok">1 red</span>', '<i>drains with the background turn id when promptId is omitted</i> — the only pin'),
    ('M2', 'rewind admission <span class="dim">session-control-plane.ts:13942</span>', 'survives', '<span class="ok">1 red</span>', "<i>rejects 'rewind' while an admitted background turn is running</i>"),
    ('M3', 'branch admission only <span class="dim">:10825</span>', 'survives', 'survives', '<span class="dim">masked by the callback copy — disclosed in the PR</span>'),
    ('M4', 'branch queue callback only <span class="dim">:10836</span>', 'survives', 'survives', '<span class="dim">masked by the admission copy — disclosed</span>'),
    ('M5', 'branch, both copies', 'survives', '<span class="ok">1 red</span>', "<i>rejects 'branch' …</i>"),
    ('M6', 'fork admission only <span class="dim">:13663</span>', 'survives', 'survives', '<span class="dim">masked — disclosed</span>'),
    ('M7', 'fork queue callback only <span class="dim">:13674</span>', 'survives', 'survives', '<span class="dim">masked — disclosed</span>'),
    ('M8', 'fork, both copies', 'survives', '<span class="ok">1 red</span>', "<i>rejects 'fork' …</i>"),
    ('M9', 'cd guard in the queue continuation <span class="dim">:11182</span>', 'survives', '<span class="ok">1 red</span>', "<i>rejects 'cd' …</i>"),
    ('M10', '<code>entryHasLocalWork</code> term <span class="dim">:2684</span>', 'survives', '<span class="ok">1 red</span>', '<i>retains a detached session …</i> — on <code>sessionCount</code> (:609) only'),
    ('M11', 'side-task concurrent release <span class="dim">:10816</span>', 'survives', 'survives', '<span class="dim">not claimed — disclosed</span>'),
]
tr = '\n'.join(f'<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td>{d}</td><td>{e}</td></tr>' for a, b, c, d, e in rows)
fig2 = f"""
<h1>Mutation matrix — whole <code>packages/acp-bridge</code> suite per mutant</h1>
<p class="sub">Production code is identical in both columns; only the two test files differ (merge-base <code>009aab05b2</code> vs PR head <code>171e1b17fc</code>).
Each mutant is one line, applied by an exact-match script that aborts unless it hits exactly once. Baselines: 2198/2198 and 2204/2204 pass.</p>
<table>
<tr><th style="width:5%"></th><th style="width:31%">Mutant (one term → <code>false</code>)</th><th style="width:15%">base tests · 2198</th><th style="width:11%">PR tests · 2204</th><th>What goes red with the PR's tests</th></tr>
{tr}
</table>
<div class="note"><b>Before this PR, every guard mutant (M2–M10) shipped green</b> — 0 of 9 caught. With it: 7 of 12 killed (M1, M1b, M2, M5, M8, M9, M10); the 5 survivors are exactly the ones the PR text discloses as per-arm masking or out of scope.</div>
<h2>The retention test (bot's open fix-induced R1-1) — only that test, <code>-t</code></h2>
<table>
<tr><th style="width:40%">Variant of <i>retains a detached session whose only work is an admitted background turn</i></th><th style="width:14%">production intact</th><th>with M10</th></tr>
<tr><td>as shipped</td><td><span class="ok">pass</span></td><td><span class="ok">red</span> at <code>:609</code> <code>sessionCount</code> — while <code>:608 expect(conditionalCloseCalls).toBe(0)</code> <b>still passes</b>: the session was torn down and the counter stayed 0 (the fake never negotiates active-work, so no conditional close is ever sent)</td></tr>
<tr><td><code>sessionReapIntervalMs: 0</code> (reaper off)</td><td><span class="ok">pass</span></td><td><span class="ok">red</span> at <code>:609</code> — so retention is decided on the detach path, not by "the reaper" the comment names (<code>entryHasLocalWork</code> feeds both)</td></tr>
<tr><td>candidate repair: <code>initializeImpl: () =&gt; activeWorkInitializeResponse()</code> + an <code>_qwencode/end_turn</code> positive control with <code>vi.waitFor(sessionCount === 0)</code></td><td><span class="ok">pass</span> <span class="dim">(session is reaped after end_turn)</span></td><td><span class="ok">red</span> on the counter: <code>expected 1 to be +0</code> — the second witness becomes live</td></tr>
</table>
<div class="note">Also on the merged tree (<code>origin/main c502f3dcfe</code> + head, clean merge, 2 files +173): whole package <b>2258 / 2258</b>; <code>eslint</code>, <code>prettier --check</code>, <code>tsc --noEmit</code> exit 0. The PR's own test-plan command reports <b>43 passed</b>; the description still says 41 and "four new ones" — the second commit added the <code>cd</code> row and the retention test.</div>
"""
render('fig2-mutation-matrix', fig2)
