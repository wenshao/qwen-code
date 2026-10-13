#!/usr/bin/env python3
"""Evidence cards for the PR #13918 verification report, built from results/*.json."""
import html
import json
import os

RIG = '/Users/wenshao/pr13918-rig'
FIG = f'{RIG}/fig'
os.makedirs(FIG, exist_ok=True)


def load(name):
    p = f'{RIG}/results/{name}/inflight.json'
    return json.load(open(p)) if os.path.exists(p) else None


CSS = """
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
.card{padding:26px 30px 30px;width:1340px}
h1{font-size:23px;margin:0 0 4px;color:#f0f6fc}
.sub{color:#8b949e;margin:0 0 18px;font-size:14px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #30363d;padding:7px 10px;vertical-align:top;text-align:left}
th{background:#161b22;color:#c9d1d9;font-weight:600}
td.k{color:#c9d1d9;white-space:nowrap;font-weight:600}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}
.cell div{white-space:nowrap}
.note{margin-top:16px;border-left:4px solid #d29922;padding:8px 14px;background:#161b22;color:#c9d1d9}
.note.red{border-color:#f85149}.note.green{border-color:#3fb950}
pre{background:#161b22;border:1px solid #30363d;padding:12px 14px;margin:8px 0 0;font:12.5px/1.45 ui-monospace,Menlo,monospace;white-space:pre;overflow:hidden;color:#c9d1d9}
.lbl{font-weight:600;margin-top:14px;color:#f0f6fc}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px}
"""


def page(title, body):
    return f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title><style>{CSS}</style></head><body><div class="card">{body}</div></body></html>'


def turn_cell(t):
    if t is None:
        return '<span class="dim">—</span>'
    st = t.get('status')
    if st == 'COMPLETED':
        return f'<span class="ok">✓ completed @{t["doneSinceHold"]:.1f}s</span>'
    return f'<span class="bad">✗ stuck {st} (≥{int(t.get("doneSinceHold") or 0)}s)</span>'


def after_cell(a):
    def one(x):
        if not x or not x.get('turn'):
            code = (x or {}).get('admit', {}).get('code')
            return 'latched' + (f' ({code})' if code else '')
        return 'ok' if x['turn'].get('status') == 'COMPLETED' else 'latched (' + x['turn'].get('status', '?') + ')'
    v, vt, idle = one(a.get('victim')), one(a.get('victimTool')), one(a.get('idle'))
    usable = (v == 'ok') + (vt == 'ok')
    cls = 'ok' if usable == 2 and idle == 'ok' else ('bad' if usable == 0 else 'warn')
    return f'<span class="{cls}">victims {usable}/2 usable · idle {idle}</span>'


def cell(r, repeat=None):
    if r is None:
        return '<td class="cell dim">not run</td>'
    d = r['during']
    rows = [f'<div>text turn: {turn_cell(d["textTurn"]["turn"])}</div>',
            f'<div>tool turn: {turn_cell(d["toolTurn"]["turn"])}</div>',
            f'<div>after hold: {after_cell(r["after"])}</div>']
    if repeat is not None:
        same = all(repeat['during'][k]['turn']['status'] == d[k]['turn']['status'] for k in ('textTurn', 'toolTurn'))
        rows.append(f'<div class="dim">repeat run: {"same outcome" if same else "DIFFERENT"}</div>')
    return '<td class="cell">' + ''.join(rows) + '</td>'


MATRIX = [
    ('both rows · 5 s', 'b_m4_both_5', 'h_m4_both_5', None, 'c_m4_both_5'),
    ('both rows · 10 s', 'b_m4_both_10', 'h_m4_both_10', None, 'c_m4_both_10'),
    ('both rows · 15 s', 'b_m4_both_15', 'h_m4_both_15', None, 'c_m4_both_15'),
    ('both rows · 20 s', 'b_m2_both_20', 'h_m2_both_20', 'h_m3_both_20', 'c_m3_both_20'),
    ('both rows · 30 s', 'b_m2_both_30', 'h_m2_both_30', 'h_m3_both_30', 'c_m3_both_30'),
    ('both rows · 40 s', 'b_m2_both_40', 'h_m2_both_40', None, 'c_m5_both_40'),
    ('both rows · 60 s', 'b_m1_both_60', 'h_m1_both_60', 'h_m3_both_60', 'c_m3_both_60'),
    ('placement guard only · 30 s', 'b_m2_placement_30', 'h_m2_placement_30', 'h_m3_placement_30', 'c_m3_placement_30'),
    ('publication CAS row only · 30 s', 'b_m2_publication_30', 'h_m2_publication_30', 'h_m3_publication_30', 'c_m3_publication_30'),
    ('publication CAS row only · 60 s', 'b_m1_publication_60', 'h_m1_publication_60', None, None),
]


def card_matrix():
    rows = []
    for label, b, h, hr, c in MATRIX:
        rb, rh, rhr, rc = load(b), load(h), load(hr) if hr else None, load(c) if c else None
        rows.append(f'<tr><td class="k">{label}</td>{cell(rb)}{cell(rh, rhr)}{cell(rc)}</tr>')
    body = f'''
<h1>Mid-turn tenant-guard hold — real stack, base vs head vs client-side candidate</h1>
<p class="sub">Spring jar + embedded Runtime Broker + packaged Hosted Harness (dist/cli.js) + MySQL 8.4.7 + scripted model. The turn is admitted and parked inside the model call; an
external transaction then holds the guard row(s) and the model is released 1 s later, so the Harness's post-model store traffic meets the held rows.
Writer lease = production default 60 s. base = main fd95f04 (merge-base) · head = 238bebd5 · candidate = head + 17-line client retry patch (same jar as head).</p>
<table><tr><th style="width:190px">Held rows · duration</th><th>base (main)</th><th>head (PR)</th><th>head + candidate client patch</th></tr>
{''.join(rows)}</table>
<div class="note red"><b>20–40 s holds regress</b> (head's boundary lies between 15 s and 20 s): base waits the hold out and both turns complete at the hold's end; head gives up after its 3 bounded attempts (≈3×5 s), arms the
Session's write latch, and the turns stay RUNNING at the public API with every later prompt refused (409 turn_active). Reproduced on a second run at 20 s / 30 s for all three row kinds.</div>
<div class="note green"><b>Kept by the PR:</b> writer leases keep renewing through a held guard (base's freeze and expire), and an idle Session survives a 60 s publication-row hold (base's does not).
<b>Candidate:</b> treating the bounded 503 <span class="mono">tenant_guard_contended</span> as a definite non-commit and retrying it inside the existing 30 s request budget matches base at every hold length here and does better at 60 s (text turn completes, idle Session stays usable), while server statements stay bounded.</div>
'''
    open(f'{FIG}/01-hold-matrix.html', 'w').write(page('Guard hold matrix', body))


def card_burst():
    def b(name):
        p = f'{RIG}/results/{name}/burst.json'
        return json.load(open(p)) if os.path.exists(p) else None

    def oc(x):
        o = x['outcomes']
        parts = []
        for k, v in sorted(o.items(), key=lambda kv: -kv[1]):
            cls = 'ok' if k == 'COMPLETED' else 'bad'
            label = 'never admitted (first turn still pending)' if k == 'no-turn' else k
            parts.append(f'<span class="{cls}">{v} {html.escape(label)}</span>')
        tail = f' <span class="dim">p50 {x["p50"]/1000:.1f}s · max {x["max"]/1000:.1f}s</span>' if x.get('p50') else ''
        return ' · '.join(parts) + tail

    rows = []
    for n, tag in [(16, 'k2'), (24, 'k3'), (40, 'k1'), (40, 'k4')]:
        for arm in ('b', 'h'):
            r = b(f'{arm}_{tag}_p20_n{n}')
            if not r:
                continue
            rec = r.get('recovery')
            rec_s = '—' if not rec else ('<span class="ok">✓</span>' if (rec.get('turn') or {}).get('status') == 'COMPLETED' else '<span class="bad">✗</span>')
            sc = r['springCounts']
            rows.append(f'<tr><td class="k">{n} Sessions · run {tag}</td><td class="k">{"base" if arm == "b" else "head"}</td>'
                        f'<td>{oc(r["firstTurns"])}</td><td>{oc(r["secondTurns"])}</td>'
                        f'<td class="mono">{sc["poolTimeout"]} / {sc["v2probe"]} / {r["harnessCounts"]["writesStopped"]}</td><td>{rec_s}</td></tr>')
    body = f'''
<h1>Concurrent Session burst at production pool defaults (Druid max-active 20, max-wait 30 s)</h1>
<p class="sub">N Sessions created at once through <span class="mono">POST /v1/agents/sessions</span> (writer acquisition + commits), each then sent one more turn, all concurrently.
Fresh stack per arm; head and base stacks run side by side on the same MySQL 8.4.7. Turns that do not finish within 150 s are counted with their last status.</p>
<table><tr><th>Burst</th><th>arm</th><th>first turn (create)</th><th>second turn</th><th>pool timeouts / "v2 probe failed" / Sessions write-latched</th><th>fresh Session after</th></tr>
{''.join(rows)}</table>
<pre>head Spring log (run k1):
org.springframework.dao.DataAccessResourceFailureException: managed_agent_operation v2 probe failed
Caused by: com.alibaba.druid.pool.GetConnectionTimeoutException: wait millis 30001, active 20, maxActive 20, creating 0
    at ...ManagedSessionStore.hasLifecycleV2Operation(ManagedSessionStore.java:235)
    at ...ManagedSessionStore.checkLifecycleWriter(ManagedSessionStore.java:202)
    at ...ManagedSessionStore.commit(ManagedSessionStore.java:595)
    at ...ManagedSessionStoreController.commit(ManagedSessionStoreController.java:124)</pre>
<div class="note red">Full-stack confirmation of the open /review P1 (11:11Z): every ordinary commit/acquire/renew/seal now borrows a <b>second</b> pool connection inside its open
transaction. Up to 24 concurrent Sessions both arms behave the same; at 40, head loses the whole burst (2/2 runs) while base completes 40/40 twice. No database lock is involved.</div>
'''
    open(f'{FIG}/02-pool-burst.html', 'w').write(page('Pool burst', body))


def card_logs():
    h20 = load('h_m2_both_20')
    hl = ['turn 4945ed1b… failed: ManagedSessionStoreHttpError: Managed Session Store GET /resources/84b207e6…?workspaceId=W1',
          '    failed after 3 attempts: A tenant-wide Managed Session guard could not be acquired within the hot-path bound; retry.',
          'turn f86f4c49… could not settle: ManagedSessionWritesStoppedError: session log writes stopped after an earlier failure:',
          '    Managed Session Store POST /transactions:commit failed: A tenant-wide Managed Session guard could not be acquired ...',
          'turn 4945ed1b… could not settle: ManagedSessionWritesStoppedError: session log writes stopped after an earlier failure: ...']
    assert any('84b207e6-264e-4aa3' in l for l in h20['harnessLines']) and any('f86f4c49-f1fb' in l for l in h20['harnessLines'])
    body = f'''
<h1>Why head latches where base recovers — and what the public API sees</h1>
<p class="sub">Excerpts from the 20 s both-rows run (head h_m2_both_20 / base b_m2_both_20) and the admission-time hold (h1 / b1).</p>
<div class="lbl">head Harness stderr (hold 20 s, model released at +1 s):</div>
<pre>{html.escape(chr(10).join(hl))}</pre>
<div class="lbl">Client budget arithmetic (packages/core http-managed-session-store.ts on head):</div>
<pre>commit:      3 attempts × (≤5 s bounded server wait + 250 ms)   → gives up after ≈15.5 s → ManagedSessionWritesStoppedError latch
GET resource: withRetry attempt cap 3 (30 s deadline unused)      → gives up after ≈15 s   → turn failed, latch
base:        the same statements simply wait (InnoDB 50 s / client 30 s) → 20 s and 30 s holds end in completed turns (40 s: text turn only)</pre>
<div class="lbl">Turn at the public API afterwards (both arms when latched): Spring never reads the Harness's in-memory recoveryReason</div>
<pre>GET turn  → status RUNNING (unchanged ≥ 300 s)       POST events → 409 turn_active
Harness   → "could not settle: ManagedSessionWritesStoppedError ..."  (the store failure is named only in Harness stderr)</pre>
<div class="lbl">Hold placed before Spring admits the turn (h1 / b1, both arms identical):</div>
<pre>POST /v1/agents/sessions/:id/events → 500 internal_error after 50.5 s
org.springframework.dao.CannotAcquireLockException: Lock wait timeout exceeded
    at ...WorkspaceMigrationAdmission.lockTenant(WorkspaceMigrationAdmission.java:14)
    at ...ManagedAgentStore.insertTurnCommand(ManagedAgentStore.java:839)
    at ...ManagedAgentService.submitTurn(ManagedAgentService.java:408)</pre>
<div class="note">Spring's own turn/session admission still takes the placement guard unbounded (not touched by this PR), so a held placement row still freezes every new
turn and Session of the tenant for InnoDB's 50 s and then answers an unnamed 500 — on base and on head alike.</div>
'''
    open(f'{FIG}/03-mechanism.html', 'w').write(page('Mechanism', body))


card_matrix()
card_burst()
card_logs()
print('cards written')
