import json, os, glob, html, sys
SCR=os.getcwd()
CSS="""<style>body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px}
.card{padding:26px 30px 24px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;color:#8b949e;font-weight:400;margin:0 0 18px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;vertical-align:top}th{background:#161b22;color:#c9d1d9}
td.mono,th.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.red{color:#f85149;font-weight:600}.green{color:#3fb950;font-weight:600}.dim{color:#8b949e}.note{border-left:4px solid #58a6ff;background:#161b22;padding:10px 14px;margin-top:16px;color:#c9d1d9}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.col h3{margin:0 0 8px;font-size:15px}.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}
.tag.base{background:#3d1d1d;color:#f85149}.tag.head{background:#1b3a25;color:#3fb950}pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;white-space:pre;background:#161b22;padding:10px 12px;border:1px solid #30363d;margin:0;overflow:hidden}
</style>"""
def load(run, arm, scen='s1'):
    p=f'{SCR}/runs/{run}/result-{arm}-{scen}.json'
    return json.load(open(p)) if os.path.exists(p) else None
def tl_rows(res, keep):
    rows=[]
    for r in res['timeline']:
        s=r['step']
        if not any(k in s for k in keep): continue
        extra={k:v for k,v in r.items() if k not in ('t','step','text')}
        if 'text' in r: extra['text']=r['text'][:40]
        rows.append((r['t'], s, extra))
    return rows
def esc(x): return html.escape(str(x))
def timeline_card(run):
    head=load(run,'head'); base=load(run,'base')
    keep=['prompt sent','PERMISSION_REQUEST','TIMEOUT','cancel','re-ask','drain','turn_complete','prompt_cancelled','holding','hold over','left unanswered']
    def col(res, arm):
        h=f'<div class="col"><h3><span class="tag {arm}">{arm.upper()}</span> &nbsp;{"ed24804e (PR head)" if arm=="head" else "ea1ad7f9 (merge-base)"}</h3><table><tr><th class="mono">t (s)</th><th>event</th><th>detail</th></tr>'
        for t,s,ex in tl_rows(res, keep):
            cls=''
            if 'PERMISSION_REQUEST' in s: cls='green'
            if 'TIMEOUT' in s: cls='red'
            det=''
            if 'PERMISSION_REQUEST' in s: det=f"requestId {ex.get('requestId','')[:8]}…"
            elif 'prompt sent' in s: det=esc(ex.get('text',''))
            elif 'TIMEOUT' in s: det=f"status: pendingInteractionCount={ex['statusB']['pendingInteractionCount']}, hasActivePrompt={ex['statusB']['hasActivePrompt']}; health.pendingPermissions={ex['health']['pendingPermissions']}"
            elif 're-ask' in s: det=f"reached={ex.get('reached')}; health.pendingPermissions={ex['health']['pendingPermissions']}"
            elif 'turn_complete' in s or 'prompt_cancelled' in s: det=f"stopReason={ex.get('stopReason')}"
            elif 'drain' in s: det=f"voted {ex.get('voted')}"
            elif 'hold' in s: det=f"health.pendingPermissions={ex['health']['pendingPermissions']}"
            h+=f'<tr><td class="mono">{t}</td><td class="{cls}">{esc(s)}</td><td class="dim">{det}</td></tr>'
        return h+'</table></div>'
    v=head['verdict']; vb=base['verdict']
    body=f"""<div class="card"><h1>PR #11802 — real <code>qwen serve</code> daemon, one <code>qwen --acp</code> child, 3 sessions (run {run})</h1>
<h2>Incident shape from #11795: session A asks (ask_user_question) and is never answered; sessions B and C then ask. Timestamps are seconds since the driver started; events are the daemon's own SSE frames on each session's <code>/events</code> stream.</h2>
<div class="grid">{col(base,'base')}{col(head,'head')}</div>
<div class="note"><b>Base:</b> B and C never reach the host while A is unanswered (the full {len(base['samples'])*2}-s window); cancelling B releases exactly one queue slot — C's request is published {'%.0f ms' % ((float([r for r in base['timeline'] if 'PERMISSION_REQUEST reached host for C' in r['step']][0]['t'])-float([r for r in base['timeline'] if r['step']=='prompt_cancelled for B'][0]['t']))*1000) if any('PERMISSION_REQUEST reached host for C' in r['step'] for r in base['timeline']) else 'n/a'} after B's <code>prompt_cancelled</code> event — and B's re-ask then queues behind the still-unanswered C, reaching the host only after A and C are answered.
<b>Head:</b> B and C reach the host {v['B_latency_s']} s / {v['C_latency_s']} s after their prompts while A stays unanswered; answering all three completes all three turns with <code>end_turn</code>.</div></div>"""
    return CSS+body
def samples_card(run):
    head=load(run,'head'); base=load(run,'base')
    def tbl(res, arm, limit):
        h=f'<div class="col"><h3><span class="tag {arm}">{arm.upper()}</span> &nbsp;GET /session/:id/status + GET /health?deep=1 every 2 s while waiting</h3><table><tr><th class="mono">t (s)</th><th>health.pendingPermissions</th><th>A</th><th>B</th><th>C</th></tr>'
        rows=res['samples']; shown=rows[:limit] if len(rows)>limit else rows
        def cell(s): return f"active={'y' if s['hasActivePrompt'] else 'n'} question={'<b>y</b>' if s['isWaitingForUserQuestion'] else 'n'} pending={s['pendingInteractionCount']}"
        for r in shown: h+=f"<tr><td class='mono'>{r['t']}</td><td>{r['health']['pendingPermissions']}</td><td>{cell(r['A'])}</td><td>{cell(r['B'])}</td><td>{cell(r['C'])}</td></tr>"
        if len(rows)>limit: h+=f"<tr><td class='mono'>…</td><td colspan=4 class='dim'>{len(rows)-limit} more identical samples up to t={rows[-1]['t']} s</td></tr>"
        if not rows: h+="<tr><td colspan=5 class='dim'>no samples: B and C were already at the host before the first 2 s tick</td></tr>"
        return h+'</table></div>'
    vb=base['verdict']
    body=f"""<div class="card"><h1>What the host can observe while B and C wait (run {run})</h1>
<h2>The queued request has not reached the bridge, so the session summary cannot report it: B and C look exactly like a session that is thinking.</h2>
<div class="grid">{tbl(base,'base',5)}{tbl(head,'head',5)}</div>
<div class="note">Base at the end of the {len(base['samples'])*2}-s window: B = {esc(json.dumps(vb['B_status_at_end']))}; daemon-wide pendingPermissions = {vb['health_at_end_of_wait']['pendingPermissions']} (that one belongs to A). Head: the single sample above fell 0.26 s before B and C reached the host; their status at the end of the wait was {esc(json.dumps(head['verdict']['B_status_at_end']))} and daemon-wide pendingPermissions stayed at 3 across the 30-s hold (see the timeline card).</div></div>"""
    return CSS+body
def provenance_card():
    body=f"""<div class="card"><h1>Arms, builds and what actually differs between the two bundles</h1>
<h2>Both daemons run from their own <code>dist/cli.js</code> and spawn their own <code>qwen --acp</code> child from the same bundle. Each arm's build is verified against the bundle the child executes, not against source.</h2>
<table><tr><th></th><th>base</th><th>head</th></tr>
<tr><td>commit</td><td class="mono">ea1ad7f995 (merge-base = first parent of the PR merge commit)</td><td class="mono">ed24804e6e (PR head, refs/pull/11802/head)</td></tr>
<tr><td>tree</td><td>head worktree APFS-cloned, then <code>git diff ed24804e6e ea1ad7f995 -- Session.ts Session.test.ts</code> applied; <code>packages/cli</code> rebuilt + re-bundled</td><td><code>git worktree add --detach</code>; full <code>npm run build &amp;&amp; npm run bundle</code></td></tr>
<tr><td class="mono">grep -o permissionRequestTails dist/chunks/acpAgent-*.js | wc -l</td><td class="mono red">3 (WeakMap keyed on the connection)</td><td class="mono">0</td></tr>
<tr><td class="mono">grep -o 'permissionRequestTail\\b' dist/chunks/acpAgent-*.js | wc -l</td><td class="mono">0</td><td class="mono green">3 (per-Session field)</td></tr>
<tr><td>bundle diff after normalising chunk hashes (510 chunks each)</td><td colspan=2><code>acpAgent</code>: 20 changed lines = exactly the PR's queue change (WeakMap → instance field, deleted <code>requestPermission</code>); <code>cli.js</code> identical; the only other differences are the generated <code>GIT_COMMIT_INFO</code>/<code>CLI_VERSION</code> constants and two <code>// wasm-binary:</code> path comments naming the worktree</td></tr>
<tr><td>daemon</td><td colspan=2><code>node dist/cli.js serve --port &lt;p&gt; --token … --workspace &lt;ws&gt;</code> with isolated <code>HOME</code>, <code>QWEN_HOME</code>, <code>QWEN_RUNTIME_DIR</code>; provider = local OpenAI-compatible fake that answers <code>[[ASK:x]]</code> with one <code>ask_user_question</code> tool call; default approval mode; <code>--permission-response-timeout-ms</code> left at its default (0 = wait forever)</td></tr>
<tr><td>sessions</td><td colspan=2><code>POST /session {{cwd, sessionScope:"thread"}}</code> ×3 → three fresh sessions on one child (<code>attached:false</code>); each observed on its own <code>GET /session/:id/events</code> SSE stream; votes via <code>POST /session/:id/permission/:requestId</code></td></tr>
<tr><td>platform</td><td colspan=2>macOS (Darwin 25.6.0), Node v24.18.1, qwen-code 0.23.3</td></tr></table></div>"""
    return CSS+body
def determinism_card():
    rows=[]
    for run in sorted(glob.glob(f'{SCR}/runs/r*')):
        rn=os.path.basename(run)
        for arm in ('base','head'):
            res=load(rn,arm)
            if not res: continue
            v=res['verdict']
            rows.append((rn,arm,v.get('B_permission_reached_host'),v.get('B_latency_s'),v.get('C_permission_reached_host'),v.get('C_latency_s'),v.get('health_at_end_of_wait',{}).get('pendingPermissions'),v.get('B_reask_after_cancel_reached_host'),v.get('health_after_drain',{}).get('pendingPermissions'), ' / '.join(str((v.get(f'{s}_turn_after_answer') or {}).get('stopReason')) for s in 'ABC')))
    h='<table><tr><th>run</th><th>arm</th><th>B reached host</th><th>B latency (s)</th><th>C reached host</th><th>C latency (s)</th><th>pendingPermissions at end of wait</th><th>B re-ask after cancel reached host (within 30 s)</th><th>pendingPermissions after drain</th><th>final stopReason A / B / C</th></tr>'
    for r in rows:
        arm=r[1]; c='green' if arm=='head' else 'red'
        h+=f"<tr><td class='mono'>{r[0]}</td><td><span class='tag {arm}'>{arm}</span></td><td class='{c}'>{r[2]}</td><td class='mono'>{r[3]}</td><td class='{c}'>{r[4]}</td><td class='mono'>{r[5]}</td><td class='mono'>{r[6]}</td><td class='mono'>{r[7] if r[7] is not None else '—'}</td><td class='mono'>{r[8]}</td><td class='mono'>{r[9]}</td></tr>"
    body=f"""<div class="card"><h1>Repeatability — every S1 run, both arms</h1><h2>Fresh daemons for every run; wait window 30–60 s; "B re-ask" column: after the timeout the driver cancels B and re-asks in B (only exercised when B was stuck, i.e. base).</h2>{h}
<div class="note">Base: 0 of {sum(1 for r in rows if r[1]=='base')} runs delivered B or C while A was unanswered; the re-ask after cancel also never reached the host within 30 s, because the cancel released one slot that C consumed first. Head: {sum(1 for r in rows if r[1]=='head' and r[2] and r[4])} of {sum(1 for r in rows if r[1]=='head')} runs delivered both B and C in well under a second.</div></div>"""
    return CSS+body
which=sys.argv[1]; run=sys.argv[2] if len(sys.argv)>2 else 'r3'
out={'timeline':timeline_card,'samples':samples_card,'provenance':lambda: provenance_card(),'determinism':lambda: determinism_card()}[which]
html_out = out(run) if which in ('timeline','samples') else out()
open(f'{SCR}/figs/{which}.html','w').write(html_out); print('wrote', which)
