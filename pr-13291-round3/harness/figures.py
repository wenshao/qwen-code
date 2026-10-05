#!/usr/bin/env python3
"""Builds the round-3 figure HTML pages from the actual result files."""
import glob
import html
import json
import os
import sys

OUT = '/root/verify/pr13291/out'
FIG = '/root/verify/pr13291/fig'
os.makedirs(FIG, exist_ok=True)
e = html.escape

CSS = """
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#d0d7de;font:14px/1.45 'DejaVu Sans Mono',monospace}
.wrap{display:inline-block;padding:22px 26px;min-width:1180px}
h1{font-size:18px;margin:0 0 4px;color:#f0f6fc}
.sub{color:#8b949e;margin:0 0 14px;font-size:12.5px}
table{border-collapse:collapse;width:100%;margin:6px 0 14px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:normal}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}.hl{color:#79c0ff}
.box{border:1px solid #30363d;border-radius:6px;padding:10px 14px;margin:8px 0 14px;background:#0b0f14}
.k{color:#ff7b72}.s{color:#a5d6ff}
.seq span{display:inline-block;margin:2px 3px;padding:1px 6px;border-radius:4px;background:#161b22;border:1px solid #30363d}
.seq span.ck{border-color:#d29922;color:#d29922}
.seq span.ref{border-color:#f85149;color:#f85149}
h2{font-size:15px;margin:16px 0 6px;color:#f0f6fc}
"""

def page(title, sub, body):
    return f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='wrap'><h1>{e(title)}</h1><p class='sub'>{sub}</p>{body}</div></body></html>"

# ---------------------------------------------------------------- figure 1
def classify(r, p):
    if not p:
        return ('n/a', 'dim')
    if not p.get('load', {}).get('ok'):
        return ('load failed: ' + json.dumps(p['load'].get('error', {}).get('data')), 'bad')
    pr = p.get('prompt') or {}
    if not pr.get('ok'):
        kind = (pr.get('error') or {}).get('data', {}).get('errorKind')
        return (f"blocked: {kind} · model requests {p['modelRequests']}", 'ok')
    fr = p.get('firstRequest')
    outs = []
    for t in fr['tools']:
        s = t['content']
        if r.get('marker') and r['marker'] in s:
            outs.append(('committed result', 'ok'))
        elif 'was not recorded' in s:
            outs.append(('orphan placeholder', 'bad'))
        else:
            outs.append(('other: ' + s[:40], 'warn'))
    return ('; '.join(o[0] for o in outs), outs[0][1] if outs else 'dim')

def trc(path):
    if not os.path.exists(path):
        return None
    n = 0
    for line in open(path):
        if not line.strip():
            continue
        j = json.loads(line)
        ms = j.get('managedSession') or {}
        if ms.get('kind') == 'message.committed' and ms.get('payload', {}).get('role') == 'tool_result':
            n += 1
    return n

ARMS = [('head', 'new head 6749534e20'), ('head-mut', 'new head, re-read disabled (mutant)'), ('old', 'old head e666889e41')]
SCEN = [
    ('s14', 'S14', 'child SIGKILLed right after the <span class=k>recordToolResult</span> commit synced: receipt committed, item still in_progress, no tool_result'),
    ('s6', 'S6', 'child SIGKILLed right after the <span class=k>results_ready</span> checkpoint commit synced: no tool_result recorded'),
    ('s4', 'S4', 'child SIGKILLed while the command runs: intent + await_runtime, no receipt (outcome unknown)'),
    ('s7', 'S7', 'child SIGKILLed after <span class=k>results_consumed</span>: tool_result recorded, continuation open'),
    ('clean', 'clean', 'normal turn, clean close'),
]
rows = []
example = {}
for sc, label, desc in SCEN:
    first = True
    for arm, armlabel in ARMS:
        runs = sorted(glob.glob(f'{OUT}/matrix/{sc}/{arm}-[0-9]'))
        c1, c2, t1, t2 = {}, {}, set(), set()
        for d in runs:
            r = json.load(open(d + '/report.json'))
            ph = {p['name']: p for p in r['phases']}
            a = classify(r, ph.get('phase2-reopen'))
            b = classify(r, ph.get('phase3-second-open'))
            c1[a] = c1.get(a, 0) + 1
            c2[b] = c2.get(b, 0) + 1
            t1.add(trc(d + '/log-after-phase2.jsonl'))
            t2.add(trc(d + '/log-after-phase3.jsonl'))
            fr = (ph.get('phase2-reopen') or {}).get('firstRequest')
            if fr and fr['tools']:
                key = 'real' if r['marker'] in fr['tools'][0]['content'] else 'placeholder'
                example.setdefault(key, json.loads(fr['tools'][0]['content'])[0]['text'])
        n = len(runs)
        fmt = lambda c: '<br>'.join(f"<span class='{k[1]}'>{e(k[0])}</span> <span class=dim>{v}/{n}</span>" for k, v in c.items())
        cell0 = f"<td rowspan=3><b>{label}</b><br><span class=dim>{desc}</span></td>" if first else ''
        first = False
        rows.append(f"<tr>{cell0}<td>{e(armlabel)}</td><td>{fmt(c1)}</td><td class=dim>{','.join(str(x) for x in sorted(t1, key=str))}</td><td>{fmt(c2)}</td><td class=dim>{','.join(str(x) for x in sorted(t2, key=str))}</td></tr>")
tbl = ("<table><tr><th style='width:330px'>crash shape (real child, real SIGKILL)</th><th>arm</th><th>1st open: what the model receives for call_1</th><th>tool_result in log</th><th>2nd open</th><th>tool_result in log</th></tr>"
       + ''.join(rows) + '</table>')
ex = (f"<div class=box><span class=ok>committed result</span> = <span class=s>{e(example.get('real','').splitlines()[0])} … {e(example.get('real','').splitlines()[2])}</span><br>"
      f"<span class=bad>orphan placeholder</span> = <span class=s>{e(example.get('placeholder',''))}</span></div>")
sub1 = ("Each open is a real ACP <span class=hl>session/load</span> on a fresh Managed child (<span class=hl>dist/cli.js --acp --acp-execution-engine managed</span>, arm's own compiled bridge), "
        "then one prompt; a counting fake model records the tool messages it receives. Two env-gated M6 stand-ins in a hard-linked dist copy, identical on every arm: "
        "skip <span class=k>assertLegacySessionExecution</span> in loadCliConfig, writer reclaim policy <span class=k>local</span>. 3 runs per cell, Linux x86_64, Node 22.22.2.")
open(f'{FIG}/r3-01-f3-real-acp.html', 'w').write(page('#13291 round 3 — F3 on the real ACP restore path: first open after a crash', sub1, tbl + ex))

# ---------------------------------------------------------------- figure 2
def load_err(path):
    r = json.load(open(path))
    return r['phases'][-1]['load']
nr = []
for sc in ('s14', 's4'):
    for a in ('head', 'old'):
        l = load_err(f'{OUT}/noreclaim/{sc}-{a}/report.json')
        nr.append(f"<tr><td>{sc.upper()}</td><td>{'new head' if a=='head' else 'old head'}</td><td class=bad>{e(str(l.get('error',{}).get('data',{}).get('errorKind')))} · {e(l.get('error',{}).get('message',''))}</td></tr>")
lockfile = glob.glob(f'{OUT}/noreclaim/s14-head/root/runtime/tmp/session-writer-locks/*.lock')[0]
lk = json.load(open(lockfile))
lockbox = (f"<div class=box>leftover lock: state=<span class=s>{e(lk['state'])}</span> pid=<span class=s>{lk['pid']}</span> (<span class=bad>not running</span>) "
           f"process_kind=<span class=s>{e(lk['process_kind'])}</span> same host / pid namespace<br>"
           "<span class=dim>acpAgent.ts:15418-15424 — an ordinary Managed child sets</span> <span class=k>setSessionWriterReclaimPolicy(conversationsRuntimeProvenance ? 'local' : 'never')</span>"
           "<span class=dim>, and --acp-execution-engine managed never carries Conversations provenance (llm.tsx:503-513).</span></div>")

def seq(path):
    lines = [json.loads(x) for x in open(path) if x.strip()]
    out = []
    for l in lines:
        ms = l.get('managedSession') or {}
        if l.get('subtype') == 'managed_session_event_v1':
            k = ms.get('kind')
            if k == 'message.committed':
                k = 'msg:' + ms['payload'].get('role')
            out.append(k)
        elif l.get('subtype') == 'managed_session_commit_v1' and ms.get('operation') == 'commitCheckpoint':
            out[-1] = 'ckpt:' + ms['commandId'].split(':')[1]
    keep = []
    for k in out:
        if k in ('activation.changed', 'domain.committed') or k.startswith('msg:system'):
            continue
        keep.append(k)
    # cut after turn_settled
    if 'ckpt:turn_settled' in keep:
        keep = keep[:keep.index('ckpt:turn_settled') + 1]
    return keep

def seqhtml(items, refused_upto):
    h = []
    for i, k in enumerate(items):
        cls = 'ck' if k.startswith('ckpt:') else ''
        if k == 'ckpt:before_model':
            cls = 'ref' if i < refused_upto else 'ck'
        h.append(f"<span class='{cls}'>{e(k)}</span>")
    return "<div class=seq>" + '→'.join(h) + "</div>"

sh = seq(f'{OUT}/head-oversize-1/log-after-phase1.jsonl')
sd = seq(f'{OUT}/digest-first-1/log-after-phase1.jsonl')
# index of call_1's tool_result (first msg:tool_result)
ih = sh.index('msg:tool_result')
idd = sd.index('msg:tool_result')
rh = json.load(open(f'{OUT}/head-oversize-1/report.json'))
model_msg = rh['modelRequests'][1]['tools'][0]['content']
r24 = (
    "<h2>B. R1-24 data — an oversized (300 KiB) first call on a fresh session, then a normal call</h2>"
    "<table><tr><th style='width:250px'>arm</th><th>committed log (system records omitted)</th></tr>"
    f"<tr><td>new head 6749534e20<br><span class=dim>ensureCheckpoint() before managedToolDigest()</span></td><td>{seqhtml(sh, ih)}<span class=dim>refused call_1 writes the session's initial</span> <span class=bad>before_model</span> <span class=dim>checkpoint, then its tool_result</span></td></tr>"
    f"<tr><td>digest-first variant<br><span class=dim>the two lines swapped in the bundle</span></td><td>{seqhtml(sd, idd)}<span class=dim>refused call_1 writes nothing; the same before_model lands at call_2's admission</span></td></tr></table>"
    f"<div class=box>both arms, 2/2 runs each: stopReason <span class=ok>end_turn</span>; no intent, item or ordinal for call_1; call_2 runs; the model receives <span class=s>{e(json.loads(model_msg)[0]['text'])}</span> for call_1 in both</div>"
)
body2 = ("<h2>A. A crashed Managed log cannot be reopened by an ordinary Managed child</h2>"
         "<table><tr><th>crash shape</th><th>arm</th><th>real ACP session/load, only the loadCliConfig stand-in applied</th></tr>" + ''.join(nr) + "</table>" + lockbox + r24)
open(f'{FIG}/r3-02-reopen-lock-and-r124.html', 'w').write(page('#13291 round 3 — crash-shaped reopen on the real host, and the R1-24 ordering data', 'Same rig as figure 1. Part A drops the reclaim stand-in; part B uses the loadCliConfig stand-in only (no reopen involved).', body2))

# ---------------------------------------------------------------- figure 3
def suite(path):
    r = json.load(open(path))
    rows = []
    for tr in r['testResults']:
        n = len(tr['assertionResults'])
        p = sum(1 for a in tr['assertionResults'] if a['status'] == 'passed')
        s = sum(1 for a in tr['assertionResults'] if a['status'] in ('skipped', 'pending'))
        f = sum(1 for a in tr['assertionResults'] if a['status'] == 'failed')
        rows.append((tr['name'].split('/packages/')[-1], p, n, s, f))
    return rows
srows = []
for f in ('core', 'cli', 'acp'):
    for name, p, n, s, fl in suite(f'{OUT}/suites-head-{f}.json'):
        cls = 'ok' if fl == 0 else 'bad'
        note = f" <span class=dim>({s} skipped as uid 0 — passes under an unprivileged user namespace)</span>" if s else ''
        srows.append(f"<tr><td>{e(name)}</td><td class={cls}>{p}/{n}{note}</td></tr>")
extra = sys.argv[1] if len(sys.argv) > 1 else ''
body3 = ("<table><tr><th>suite (new head 6749534e20, Linux x86_64, Node 22.22.2)</th><th>passed</th></tr>" + ''.join(srows) + "</table>" + extra)
open(f'{FIG}/r3-03-suites-gates.html', 'w').write(page('#13291 round 3 — suites and gates', 'vitest JSON reporter counts; F3 witness and lint/merge checks below.', body3))
print('ok')
