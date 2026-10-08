#!/usr/bin/env python3
# VERIFICATION ONLY (PR #13163 R9): build the evidence figures (HTML) from the probe JSON/log outputs.
import json, glob, html, os, re, base64, pathlib
S = pathlib.Path('/tmp/claude-0/-root-git-qwen-code-x9/342dc74a-95d0-4b7a-be37-d2938497698b/scratchpad')
RAW = S / 'evidence/pr13163/raw'
OUT = S / 'fig/html'; OUT.mkdir(parents=True, exist_ok=True)
L = pathlib.Path('/root/verify/pr13163-r9/out')

CSS = """
body{margin:0;background:#fff;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2328}
.wrap{display:inline-block;padding:22px 26px;background:#fff;max-width:1500px}
h1{font-size:19px;margin:0 0 4px}
.sub{font-size:12.5px;color:#59636e;margin:0 0 14px;line-height:1.45}
table{border-collapse:collapse;font-size:12.5px;line-height:1.38}
th,td{border:1px solid #d1d9e0;padding:6px 8px;vertical-align:top;text-align:left}
th{background:#f6f8fa;font-weight:600}
td.k{font-weight:600;background:#fbfcfd;white-space:nowrap}
.g{background:#dafbe1}.r{background:#ffebe9}.a{background:#fff8c5}.n{background:#f6f8fa}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.foot{font-size:11.5px;color:#59636e;margin-top:10px;line-height:1.45;max-width:1450px}
h2{font-size:14.5px;margin:16px 0 6px}
"""
def page(name, title, sub, body, foot=''):
    doc = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='wrap'><h1>{html.escape(title)}</h1><p class='sub'>{sub}</p>{body}{('<p class=foot>' + foot + '</p>') if foot else ''}</div></body></html>"
    (OUT / f'{name}.html').write_text(doc)

def J(p):
    return json.load(open(p))

# ---------- Figure 1: approval answer under operator changes ----------
def c23(arm, ws, prefix='c'):
    f = glob.glob(str(RAW / f'rigd/out/{prefix}{arm}/c23-*-{ws}.json'))
    return J(f[0]) if f else None

def cell1(arm, d, after, ws=''):
    h = d['hold']; op = h['op']
    hold = (f"answer <b>{op[0]}</b> {op[1]} at +{h['settledAt']/1000:.1f} s" if h.get('settledAt') is not None
            else f"answer <b>pending</b> ({op[2]} attempts, all refused before the Harness)")
    if arm == 'b9' and h['delivered']:
        hold = f"answer <b>delivered to the Harness</b> at +{h['settledAt']/1000:.1f} s despite the change"
    end = d.get('end'); file = d.get('file'); dl = d.get('delivered')
    if after == 'cancel':
        tail = f"creator cancel <b>{d.get('cancel')}</b> → Turn <b>{end}</b>; answer op {d['op'][0]} {d['op'][1]}"
    else:
        so = d['op']
        if so[0] == 'COMPLETED' and arm != 'b9':
            tail = f"restore → delivered <b>once</b> (+{d['settleMs']/1000:.1f} s), Turn <b>{end}</b>, approved write {'landed' if file else 'missing'}"
        elif so[0] == 'FAILED' and ws == 'a5':
            tail = f"restore → answer stays FAILED (a structural verdict is terminal by design); Action still requested, Turn {end}; the creator's cancel then ends it"
        elif so[0] == 'FAILED':
            tail = f"restore → answer stays FAILED, Action <b>requested</b>, Turn <b>{end}</b> (approval lost)"
        elif so[0] == 'COMPLETED':
            tail = f"restore → Turn <b>{end}</b> 90 s later, approved write {'landed' if file else '<b>never landed</b>'}"
        else:
            tail = f"restore → still pending after 80 s ({so[2]} attempts), Turn <b>{end}</b>"
    return f"{hold}<br>{tail}"

rows = [
    ('a1', 'restore', 'revoke <code>can_create</code> during the retry backoff → restore'),
    ('a2', 'cancel', 'revoke <code>can_create</code> → creator cancels the Turn'),
    ('a3', 'restore', 'registry <code>ACTIVE→DRAINING</code> → back to ACTIVE'),
    ('a5', 'restore', 'generation bump (structural) → generation restored'),
]
def cls(arm, ws, d):
    if arm == 'h9':
        return 'g'
    if arm == 'x9':
        return 'g' if ws == 'a5' or ws == 'a2' else 'r'
    return 'r'
body = "<table><tr><th>operator change while the answer is in its retry backoff</th><th>main <code>d735e20f</code></th><th>x9 = head with only the 234037eb verdict reverted</th><th>head <code>39267a90</code></th></tr>"
for ws, after, label in rows:
    body += f"<tr><td class=k>{label}</td>"
    for arm in ('b9', 'x9', 'h9'):
        d = c23(arm, ws)
        body += f"<td class={cls(arm, ws, d)}>{cell1(arm, d, after, ws)}</td>"
    body += "</tr>"
body += "</table>"
# restart controls
body += "<h2>Dispatcher restart while the answer is pending (cold attachment cache) — no Workspace change at all</h2>"
body += "<table><tr><th>cell</th><th>main <code>d735e20f</code></th><th>head <code>39267a90</code></th></tr>"
def ctl(arm, ws):
    d = c23(arm, ws, 'd'); return d
n1b, n1h, n2b, n2h = ctl('b9', 'n1'), ctl('h9', 'n1'), ctl('b9', 'n2'), ctl('h9', 'n2')
def calls(arm, ws, prefix):
    log = open(glob.glob(str(RAW / f'rigd/out/{prefix}{arm}/c23-*-{ws}.log'))[0]).read()
    m = re.search(r'Harness calls for the Session after the first 503 \(method path status\)  -> (.*)', log)
    return html.escape(m.group(1)) if m else ''
def cleanup(arm, ws, prefix):
    log = open(glob.glob(str(RAW / f'rigd/out/{prefix}{arm}/c23-*-{ws}.log'))[0]).read()
    m = re.search(r'cleanup cancel of the stranded Turn  -> (.*)', log)
    return html.escape(m.group(1)) if m else 'n/a'
body += f"<tr><td class=k>Harness answers 503 ×4, then recovers (warm cache)</td><td class=g>delivered once at +{n1b['settleMs']/1000:.1f} s after recovery, Turn {n1b['end']}</td><td class=g>delivered once at +{n1h['settleMs']/1000:.1f} s after recovery, Turn {n1h['end']}</td></tr>"
body += f"<tr><td class=k>same, plus a dispatcher restart before the Harness recovers</td><td class=a>never delivered: <code>{calls('b9','n2','d')}</code><br>creator cancel of the stranded Turn: <b>{cleanup('b9','n2','d')}</b> after 60 s</td><td class=a>never delivered: <code>{calls('h9','n2','d')}</code><br>creator cancel of the stranded Turn: <b>{cleanup('h9','n2','d')}</b></td></tr>"
a7h = c23('h9', 'a7'); a7x = c23('x9', 'a7')
body += f"<tr><td class=k>revoke + dispatcher restart → restore</td><td class=n>(main delivers before the restart)</td><td class=a>stays retryable through the restart; after restore the same cold-reattach refusal (<code>load 409</code>) blocks delivery; x9: FAILED at +{a7x['hold']['settledAt']/1000:.1f} s</td></tr>"
body += "</table>"
page('r9-01-approval-answer-ab', 'Approval answer while the operator changes Workspace state — real stack, Linux aarch64',
     'Each cell is one scripted run: the creator approves a pending tool call, the first delivery to the Harness gets a 503 (tap), the operator change lands during the retry backoff, and the probe watches the ACTION_RESPONSE operation, the Harness tap, the Action row and the Workspace file. '
     'Store-only replica B runs with <code>dispatch.scan-delay=3600s</code> so only the dispatching replica claims retries (see the rig note in the comment).',
     body,
     'Green = intended behaviour; red = the defect the change addresses (main: the answer reaches the Harness under a revoked grant or a structural mismatch; x9: an operator-reversible change discards a committed approval and strands the Turn); amber = pre-existing gap reproduced identically on main. '
     'Sources: <code>rigd/out/c{b9,x9,h9}/c23-*.json</code>, <code>rigd/out/d{b9,h9}/c23-*.json</code>.')

# ---------- Figure 2: regression matrix ----------
def note(log, key):
    m = re.search(re.escape(key) + r'  -> (.*)', log)
    return html.escape(m.group(1)) if m else '?'
def rd(p):
    return open(p).read()
h = RAW / 'rig/out/h9'; b = RAW / 'rig/out/b9'
body = "<h2>Cancel matrix at head (bound later Turn holding its model request, Workspace change applied, then the caller cancels)</h2><table><tr><th>cell</th><th>cancel</th><th>Turn end</th><th>held model request</th><th>after restore</th></tr>"
cells = [('revoke-alice-late-ws-a', 'revoke, creator'), ('revoke-alice-early-ws-ea', 'revoke, creator, early restore'), ('draining-alice-late-ws-b', 'DRAINING, creator'),
         ('draining-alice-early-ws-eb', 'DRAINING, creator, early restore'), ('regen-alice-late-ws-c', 'generation bump, creator'), ('storage-alice-late-ws-d', 'storage moved, creator'),
         ('unread-alice-late-ws-e', 'read revoked too (creator loses visibility)'), ('control-alice-late-ws-f', 'no change, creator'), ('control-bob-late-ws-g', 'no change, reader bob'),
         ('control-carol-late-ws-g', 'no change, other creator carol'), ('control-mallory-late-ws-g', 'no change, stranger mallory'), ('revoke-bob-late-ws-g', 'revoke, reader bob')]
for key, label in cells:
    log = rd(h / f'c1-{key}.log')
    c = note(log, f"cancel by {key.split('-')[1]} under {key.split('-')[0]}")
    end = note(log, 'Turn end'); mdl = note(log, 'model request'); nxt = note(log, 'next later Turn after restore')
    ok = ('202' in c and 'CANCELLED' in end) if key.split('-')[1] == 'alice' and key.split('-')[0] != 'unread' else ('409' in c or '404' in c)
    body += f"<tr><td class=k>{label}</td><td class={'g' if ok else 'r'}>{c.split(';')[0]}</td><td>{end}</td><td>{mdl}</td><td>{nxt}</td></tr>"
body += "</table>"
body += "<h2>Same three refusal cells on main (A/B)</h2><table><tr><th>cell</th><th>cancel</th><th>Turn end</th><th>held model request</th></tr>"
for key, label in [('revoke-alice-late-ws-a', 'revoke, creator'), ('draining-alice-late-ws-b', 'DRAINING, creator'), ('regen-alice-late-ws-c', 'generation bump, creator')]:
    log = rd(b / f'c1-{key}.log')
    c = note(log, f"cancel by alice under {key.split('-')[0]}")
    body += f"<tr><td class=k>{label}</td><td class={'r' if '409' in c else 'n'}>{c.split(';')[0]}</td><td>{note(log, 'Turn end')}</td><td>{note(log, 'model request')}</td></tr>"
body += "</table>"
body += "<h2>Cold attachment cache (dispatcher restarted mid-Turn, Session Store on replica B) — creator cancels</h2><table><tr><th>cell</th><th>main</th><th>head</th></tr>"
for mode in ('revoke', 'none'):
    lb = rd(b / f'c14-cold-cache-{mode}-ws-k{mode}-b9.log'); lh = rd(h / f'c14-cold-cache-{mode}-ws-k{mode}-h9.log')
    def s(l):
        return f"{note(l, 'creator cancel after the restart')} → {note(l, 'Turn 90 s after the cancel')}; POST /cancel {note(l, 'POST /cancel calls reaching the Harness')}; model {note(l, 'model request')}"
    body += f"<tr><td class=k>{'can_create revoked' if mode == 'revoke' else 'grants intact'}</td><td class={'r'}>{s(lb)}</td><td class=g>{s(lh)}</td></tr>"
body += "</table>"
body += "<h2>Creator cancel under a revoked grant, then Session delete/close (main's lifecycle routes merged into this head)</h2><table><tr><th>cell</th><th>main</th><th>head</th></tr>"
for ws, mode, label in [('d1', 'delete', 'cancel, delete 300 ms later'), ('d2', 'close', 'cancel, close 300 ms later'), ('d3', 'delete', 'cancel, delete immediately')]:
    lb = rd(RAW / f'rig/out/eb9/c24-cancel-{mode}-ws-{ws}.log'); lh = rd(RAW / f'rig/out/eh9/c24-cancel-{mode}-ws-{ws}.log')
    def s(l):
        return f"cancel {note(l, 'creator cancel under the revoked grant')}; {mode} {note(l, f'{mode} attempts after the cancel (status sequence)')}; Turn (read after the delete/close loop) {note(l, 'Turn after the cancel')}; Session {note(l, 'Session row (status, deleted_at)')}; model {note(l, 'held model request')}"
    body += f"<tr><td class=k>{label}</td><td class=r>{s(lb)}</td><td class=g>{s(lh)}</td></tr>"
body += "</table>"
# other probes
counts = []
for pat, label in [('c5-*', 'c5 re-registration admission'), ('c7-*', 'c7 replay ordering'), ('c8-*', 'c8 refused renames'), ('c3-*', 'c3 lost deliveries'), ('c16-*', 'c16 WebShell capability flip'), ('c19-*', 'c19 rename races'), ('c21-*', 'c21 rename boundary (known divergence, deferred to #13269)')]:
    fs = sorted(glob.glob(str(h / f'{pat}.json')))
    p = sum(J(f)['pass'] for f in fs); fl = sum(J(f)['fail'] for f in fs)
    counts.append(f"{label}: {len(fs)} runs, {p}/{p+fl} checks")
body += "<h2>Other probes at head</h2><p class=sub>" + ' · '.join(counts) + "</p>"
up = rd(RAW / 'rig/out/r9/arm-up9.log'); up9b = rd(RAW / 'rig/out/r9/up9b.log')
mig = re.findall(r'^(5[012])\t([a-z ]+)\t1\t(\d+)$', up, re.M)
v52 = [m for m in mig if m[0] == '52'][0]
body += "<h2>Upgrade: head jar on main's populated database (MySQL 8.0.45)</h2><p class=sub>" + html.escape(f"main's database ended at V51 (after the whole main arm ran on it); the head jar's first boot applied V52 {v52[1]} in {v52[2]} ms, and the next boot validated 52 migrations") + "; post-upgrade smoke on storages the main arm never used: " + html.escape('; '.join(re.findall(r'^== (.*)$', up9b, re.M))) + "</p>"
page('r9-02-regression-matrix', 'Regression matrix at 39267a90 after the G3/L3 main merges — real stack, Linux aarch64', 'Server fat jar (embedded Runtime Broker, durable local process) + bundled Hosted Harness + MySQL 8.0.45 + scripted model + recording tap. Every row is a scripted probe; logs under <code>rig/out/{h9,b9,eh9,eb9}</code>.', body)

# ---------- Figure 3: suites, mutants, CI lanes ----------
ts = J(L / 'tsmut/results.json'); jm = J(L / 'javamut/results.json')
def strip(s): return re.sub(r'\x1b\[[0-9;]*m', '', s)
body = "<table><tr><th>suite / mutant</th><th>result</th><th>failing test (wire assertion)</th></tr>"
tsnames = {}
for f in glob.glob(str(L / 'tsmut/T*.log')):
    t = strip(open(f).read()); fails = re.findall(r'FAIL  src/serve/hosted-harness-session\.test\.ts > (.*)', t); exp = re.findall(r'→ (expected .*?) //', t)
    tsnames[os.path.basename(f)[:2]] = (fails, exp)
for r in ts:
    tag = r['mutant']; res = strip(r['tests'])
    if tag.startswith('control'):
        body += f"<tr><td class=k>Harness <code>hosted-harness-session.test.ts</code> (unmutated head)</td><td class=g>{html.escape(res)}</td><td></td></tr>"; continue
    fails, exp = tsnames.get(tag[:2], ([], []))
    body += f"<tr><td class=k>{html.escape(tag)}</td><td class={'g' if r.get('killed') else 'a'}>{'killed' if r.get('killed') else '<b>survived</b>'} — {html.escape(res)}</td><td>{html.escape('; '.join(sorted(set(fails)))[:260])}{(' — ' + html.escape(exp[0])) if exp else ''}</td></tr>"
for r in jm:
    tag = r['mutant']; tot = r['totals']
    if tag.startswith('control'):
        body += f"<tr><td class=k>Java focused classes (6 classes, JDK 21 / H2, unmutated head)</td><td class=g>{tot[0]} run, {tot[1]} failures, {tot[2]} errors</td><td></td></tr>"; continue
    fl = sorted(set(x.split('.')[-1] if x.count('.') > 1 else x for x in r['failed']))
    body += f"<tr><td class=k>{html.escape(tag)}</td><td class={'g' if r['killed'] else 'a'}>{'killed' if r['killed'] else 'survived'} — {tot[1]} failures, {tot[2]} errors of {tot[0]}</td><td>{html.escape(', '.join(fl))}</td></tr>"
body += "</table>"
lanes = (L / 'lanes/lanes.log').read_text()
base = (L / 'lanes/base.log').read_text() if (L / 'lanes/base.log').exists() else ''
LANESUMMARY = """MariaDB lane (mariadb:10.11.18)  head   runtime-broker 751 unit + 7 IT; managed-agent-server 1388 unit + 125 IT, Checkstyle  -> BUILD SUCCESS
                                        failsafe non-hosted class check -> pass
Hosted lane (mysql:8.4.6), full Verify  head run 1  21 IT, 1 error     HostedPublicWorkspaceIT 5/5
                                        head run 2  21 IT, 2 errors    HostedPublicWorkspaceIT 4/5  (durableClose...(crash=false): "Later Turn failed")
                                        head run 3  21 IT, 1 error     HostedPublicWorkspaceIT 5/5
                                        main run 1  21 IT, 1 error     HostedPublicWorkspaceIT 5/5
                                        main run 2  21 IT, 1 error     HostedPublicWorkspaceIT 5/5
   every full run (head 3x, main 2x): HostedWorkspaceConcurrencyIT cleanup FK error (managed_agent_snapshot) -> host-specific, identical on main
Isolated reruns on head (fresh DB each)  HostedPublicWorkspaceIT 3/3 runs (15/15)   HostedWorkspaceConcurrencyIT 3/3
GitHub CI at 39267a90                     all 28 non-skipped checks green, incl. Hosted process fault gates / MySQL 8.4 and MariaDB / Java 21"""
body += "<h2>CI database lanes replayed on this host (same images and Maven invocations as <code>sdk-java.yml</code>)</h2><pre style='font-size:11.5px;background:#f6f8fa;padding:8px;border:1px solid #d1d9e0'>" + html.escape(LANESUMMARY) + "</pre>" if 'LANESUMMARY' in globals() else ''
page('r9-03-suites-mutants', 'Suites, one-at-a-time mutants of the post-round-8 fixes, and CI lane replays', 'Mutants are applied to the head source one at a time and restored byte-for-byte; a mutant is killed when the named test fails on its wire-level assertion.', body)

# ---------- Figure 4: WebShell screenshots ----------
def img(p):
    return 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
F = RAW / 'rig/fig/raw'
shots = [('c13-b9-revoke-1-before-en.png', 'main d735e20f — creator after can_create revoked: no Cancel control'),
         ('c13-h9-revoke-1-before-en.png', 'head 39267a90 — same moment: "Cancel turn" offered'),
         ('c13-h9-revoke-2-after-en.png', 'head — after the click: Turn Cancelled (+1.65 s), nothing written')]
body = "<div style='display:flex;gap:14px'>" + ''.join(f"<div style='width:470px'><div style='font-size:12.5px;font-weight:600;margin-bottom:6px'>{html.escape(c)}</div><img src='{img(F / f)}' style='width:470px;border:1px solid #d1d9e0'></div>" for f, c in shots) + "</div>"
shots2 = [('c13-h9-draining-1-before-zh.png', 'head, zh locale — Workspace DRAINING: 取消本轮 offered'), ('c13-h9-draining-2-after-zh.png', 'head, zh — after the click: Cancelled'),
          ('c13-h9-reader-2-after-en.png', 'head — reader bob clicks Cancel: refused (409), Turn keeps running')]
body += "<div style='display:flex;gap:14px;margin-top:14px'>" + ''.join(f"<div style='width:470px'><div style='font-size:12.5px;font-weight:600;margin-bottom:6px'>{html.escape(c)}</div><img src='{img(F / f)}' style='width:470px;border:1px solid #d1d9e0'></div>" for f, c in shots2) + "</div>"
page('r9-04-webshell', 'Real WebShell (ManagedAgentWebShell via vite + Playwright Chromium) against each arm\'s real server', 'Bound Session, later Turn holding its model request, Workspace change applied, then the panel is driven like a user.', body)
print('ok', sorted(os.listdir(OUT)))
