#!/usr/bin/env python3
"""Evidence cards for the PR #12752 verification report."""
import html

OUT = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ee3d6caa-6091-40f9-ade7-5e9a755f3096/scratchpad/fig'

CSS = """
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.card{width:1380px;padding:28px 34px 30px}
h1{font-size:23px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:14px;margin-bottom:18px}
h2{font-size:16.5px;margin:20px 0 8px;color:#e6edf3;font-weight:620}
table{border-collapse:collapse;width:100%;font-size:13.8px}
th{text-align:left;color:#8b949e;font-weight:600;border-bottom:1px solid #30363d;padding:6px 10px}
td{border-bottom:1px solid #21262d;padding:6px 10px;vertical-align:top}
.nw{white-space:nowrap}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.8px}
.ok{color:#3fb950;font-weight:650}
.bad{color:#f85149;font-weight:650}
.warn{color:#d29922;font-weight:650}
.dim{color:#8b949e}
.note{border-left:4px solid #3fb950;background:#161b22;padding:10px 14px;margin-top:16px;font-size:14.2px}
.note.warn{border-left-color:#d29922;color:#e6edf3;font-weight:400}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.tag{display:inline-block;border:1px solid #30363d;border-radius:10px;padding:0 7px;font-size:12px;color:#8b949e;margin-left:6px}
"""


def page(title, body):
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{title}'
            f'</title><style>{CSS}</style></head><body><div class="card">'
            f'{body}</div></body></html>')


def esc(text):
    return html.escape(text)


# ---------------------------------------------------------------- figure 1
runs = [
    ('macOS run 1', '16 / 16', '1:40 (Maven total)', '0 / 0'),
    ('macOS run 2', '16 / 16', '102 s wall', '0 / 0'),
    ('macOS run 3', '16 / 16', '98 s wall', '0 / 0'),
    ('macOS run 4', '16 / 16', '100 s wall', '0 / 0'),
    ('macOS run 5', '16 / 16', '98 s wall', '0 / 0'),
    ('macOS run 6', '16 / 16', '100 s wall', '0 / 0'),
    ('CI · ubuntu-latest, Temurin 21 (run 36232060448)', '16 / 16',
     '1:33 (step); job 9m40s', 'n/a'),
]
rows = ''.join(
    f'<tr><td>{esc(a)}</td><td class="ok nw">{esc(b)}</td><td>{esc(c)}</td>'
    f'<td>{esc(d)}</td></tr>' for a, b, c, d in runs)
classes = [
    ('ProcessCrashFaultGateTest (FG3)', 6, '49.4 s', '44.8 s'),
    ('LostResponseFaultGateTest (FG2)', 7, '34.2 s', '30.0 s'),
    ('ConcurrencyStorageFaultGateTest (FG4)', 2, '13.7 s', '13.0 s'),
    ('FaultGateControlTest (FG1)', 1, '2.2 s', '1.9 s'),
]
crow = ''.join(
    f'<tr><td class="mono">{esc(a)}</td><td>{b}</td><td>{c}</td><td>{d}</td>'
    f'</tr>' for a, b, c, d in classes)
claims = [
    ('<code>mvn test</code> (default suite, gates excluded)',
     '<span class="ok">334 run, 0 failures</span>'),
    ('<code>mvn checkstyle:check</code>',
     '<span class="ok">0 violations</span> <span class="dim">(main sources '
     'only: an unused import in a <i>test</i> file also reports 0; the same '
     'import in a main file fails)</span>'),
    ('<code>-Dqwen.cli.entry=/nonexistent/dist/cli.js</code>',
     '<span class="ok">fails</span> <code>… is missing; run `npm run build '
     '&amp;&amp; npm run bundle` at the repository root first</code>'),
    ('<code>node</code> removed from PATH',
     '<span class="ok">fails</span> <code>node is required on PATH</code>'),
    ('Leftovers after each run (workers / Broker JVMs / temp dirs)',
     '<span class="ok">0 / 0 / 0</span> after all 6 runs and every mutant run, failing ones included'),
    ('Surefire fork SIGKILLed mid-gate (FG3 production-restart pin)',
     '<span class="warn">1 orphaned worker (ppid 1) + the rig temp dir remain</span> '
     '<span class="dim">— the live Broker exits on stdin EOF; local-only '
     'hygiene, hosted runners are discarded</span>'),
]
clrow = ''.join(f'<tr><td>{a}</td><td>{b}</td></tr>' for a, b in claims)
fig1 = page('fig1', f"""
<h1>PR #12752 · Stage F fault gates on a real macOS host</h1>
<div class="sub">head <code>c6f197d</code> (one commit on <code>1dbb378</code> = main) ·
bundle built from the PR (<code>npm run build &amp;&amp; npm run bundle</code>) ·
macOS 26.6.2 arm64 (M1 Max) · Zulu JDK 21.0.12 · Maven 3.9.16 · Node 24.18.1 ·
the PR's test table marks macOS "not tested"</div>
<div class="grid">
<div><h2>Six consecutive full runs + the PR's own CI step</h2>
<table><tr><th>Run</th><th>Gates</th><th>Time</th><th>Left workers / Brokers</th></tr>{rows}</table></div>
<div><h2>Per class: macOS run 1 vs CI</h2>
<table><tr><th>Class</th><th>Tests</th><th>macOS</th><th>CI</th></tr>{crow}</table>
<div class="note">96 / 96 gate executions green on macOS, runs 98–102 s each; the CI lane
adds 1:33 to a 9m40s job (limit 30 min). Nothing was skipped: every gate ran against the
real bundled <code>managed-runtime-worker</code>.</div></div>
</div>
<h2>Test-plan claims, re-run</h2>
<table><tr><th>Check</th><th>Observed</th></tr>{clrow}</table>
""")

# ---------------------------------------------------------------- figure 2
mut = [
    ('M01', 'failed execute settles as <code>error</code>, not UNKNOWN', 'FG2 execute lost ×3, FG3 worker killed',
     'timed out waiting for UNKNOWN; the execution is SETTLED error'),
    ('M02', 'failed execute is sent once more', 'FG2 execute lost ×3',
     'timed out waiting for UNKNOWN; the execution is SETTLED success'),
    ('M03', 'failed status lookup counts as <code>not_started</code>', 'FG2 status lost',
     'DROP status settled the execution'),
    ('M04', 'failed cancel counts as <code>cancelled</code>', 'FG2 cancel lost',
     'a lost cancel answer was reported'),
    ('M05', 'service ignores a failed attestation', 'FG2 attestation lost [service]',
     'a lost attestation produced a binding'),
    ('M06', 'provisioner ignores a failed attestation', 'FG2 attestation lost [provisioner]',
     'a lost attestation produced a binding'),
    ('M07', '<code>claimDispatch</code> re-grants a lapsed EXECUTING claim', 'FG3 Broker killed ×3',
     'expected: &lt;UNKNOWN&gt; but was: &lt;EXECUTING&gt;'),
    ('M08', 'Runtime <code>unknown</code> counts as <code>not_started</code>', 'FG3 Broker killed [after claim]',
     'expected: &lt;UNRESOLVED&gt; but was: &lt;RESOLVED&gt;'),
    ('M09', 'fenced dispatcher commits its late answer', 'FG4 takeover',
     'the fenced record broke: SETTLED'),
    ('M10', 'failed commit retried in a loop', 'FG4 storage lost',
     'commit attempts during the outage kept changing; last value: 285'),
    ('M11', "dead worker's UNKNOWN call settled as <code>error</code>", 'FG3 worker killed',
     'a dead generation settled an execution'),
    ('M12', 'reconcile also looks up settled rows', 'FG4 takeover',
     'Broker call failed: 503 runtime_execution_reconcile_failed'),
    ('W1', '<b>worker</b> re-runs a duplicate execute instead of joining', 'FG2 execute lost ×3',
     'expected: &lt;[ran]&gt; but was: &lt;[ran, ran]&gt;'),
    ('W2', '<b>worker</b> cancel never aborts the running tool', 'FG2 cancel lost',
     'marker broke: [start, end]'),
    ('W3', '<b>worker</b> answers settled/<code>not_started</code> for an unseen call', 'FG3 Broker killed [after claim]',
     'expected: &lt;UNRESOLVED&gt; but was: &lt;RESOLVED&gt;'),
]
mrow = ''.join(
    f'<tr><td class="mono">{a}</td><td>{b}</td><td>{c}</td>'
    f'<td class="mono">{d}</td><td class="ok">killed</td></tr>'
    for a, b, c, d in mut)
fig2 = page('fig2', f"""
<h1>Mutation matrix · 15 / 15 killed</h1>
<div class="sub">M01–M12 re-implement the PR's table from scratch (each alone, on a copy of the
module, against the PR's bundle); W1–W3 patch the <i>bundled TypeScript worker</i> chunk instead,
which the PR's table never mutates. Pristine control: 16 / 16 green in the same harness.</div>
<table><tr><th>#</th><th>Mutation</th><th>Gate run</th><th>First failing assertion</th><th></th></tr>{mrow}</table>
<div class="note">Every row of the PR's mutation table reproduces, with the named gate failing for the
stated reason. The worker rows show the gates also guard the Runtime side: the marker file catches a
worker that re-runs a joined call (W1) or ignores an abort (W2), and the after-claim window catches a
worker that invents a terminal answer (W3).</div>
""")

# ---------------------------------------------------------------- figure 3
timing = [
    ('P0', 'PR as is', '2 885', '—', 'pass', 'ok'),
    ('T0', '+ 9 s stall before thaw (stands in for a slow takeover)', '12 109', '—', 'pass', 'ok'),
    ('T9', '+ 9 s stall + M09 (fenced dispatcher commits late answer)', '12 371', 'M09', 'PASS — mutant survives', 'bad'),
    ('C0', 'candidate: stale Broker request timeout 90 s, + stall', '12 447', '—', 'pass', 'ok'),
    ('C9', 'candidate + stall + M09', '12 556', 'M09', 'killed: the fenced record broke: SETTLED', 'ok'),
]
trow = ''.join(
    f'<tr><td class="mono">{a}</td><td>{b}</td><td class="mono">{c}</td>'
    f'<td class="mono">{d}</td><td class="{f}">{e}</td></tr>'
    for a, b, c, d, e, f in timing)
att = [
    ('A1', 'test adapter: <code>observeRecord</code> skips its re-attestation', '1', 'pass (3 / 3)', 'bad'),
    ('A2', '<b>production</b>: <code>adoptObservation</code> skips its re-attestation', '1', 'pass (3 / 3)', 'bad'),
    ('A123', 'A1 + A2 + <code>confirm</code> skip: no attestation at all after restart', '0', 'pass (3 / 3)', 'bad'),
    ('Q0', 'candidate pin <code>assertEquals(2, secondProxy.count("attest"))</code>', '2', 'pass (3 / 3)', 'ok'),
    ('QA1', 'pin + A1', '1', 'killed (3 / 3)', 'ok'),
    ('QA2', 'pin + A2', '1', 'killed (3 / 3)', 'ok'),
    ('QA123', 'pin + A123', '0', 'killed (3 / 3)', 'ok'),
]
arow = ''.join(
    f'<tr><td class="mono">{a}</td><td>{b}</td><td class="mono">{c}</td>'
    f'<td class="{e}">{d}</td></tr>' for a, b, c, d, e in att)
fig3 = page('fig3', f"""
<h1>Two places where the gates still pass with the guarded behavior gone</h1>
<div class="sub">Neither is a production bug. Both are test-only hardening: the candidate below is +14 / −2 in
three test files, and the full suite stays 16 / 16 with it.</div>
<h2>1 · FG4 takeover: M09 is killed only while the held answer beats the stale Broker's 10 s request timeout</h2>
<table><tr><th>Arm</th><th>Change</th><th>held→release ms</th><th>Mutant</th><th>Gate</th></tr>{trow}</table>
<div class="note warn">Today the margin is about 7 s (2.9 s used of 10 s; CI's class time is the same as local).
Past it, the stale Broker's <code>HttpClient</code> times out, the late-answer path never runs, and the gate stays
green with M09 applied. This is the race the PR notes it already fixed once (the old <code>sleep 5</code> vs a 5 s timeout).
Giving only the stale Broker a longer request timeout takes the race out.</div>
<h2>2 · FG3 restart adoption: "re-proves identity before reuse" is not pinned</h2>
<table><tr><th>Arm</th><th>Change</th><th>attests seen by 2nd Broker</th><th>FG3 Broker-killed gates</th></tr>{arow}</table>
<div class="note warn">With every attestation after the restart removed (A123), the three adoption gates are green:
they check the same binding, generation and endpoint and no new worker, but not that identity was re-proved.
The production-only mutant (A2) survives because the test adapter attests on its own. FG1 already pins exact
attest counts (2, then 3); the same one-line count in FG3 kills A1, A2 and A123.</div>
""")

for name, body in (('fig1', fig1), ('fig2', fig2), ('fig3', fig3)):
    with open(f'{OUT}/{name}.html', 'w', encoding='utf-8') as out:
        out.write(body)
print('ok')
