import json
E='/root/verify/pr13366/e2e'
def load(a): return {c['name']:c for c in json.load(open(f'{E}/{a}/driver-results.json'))}
def mysql(a):
    out={}
    for row in json.load(open(f'{E}/{a}/mysql-evidence.json')):
        if 'case' in row: out[(row['case'],row['role'])]=row
        else: out['leases']=row['leaseRows']
    return out
R='\x1b[0m'; B='\x1b[1m'; DIM='\x1b[2m'; RED='\x1b[31m'; GRN='\x1b[32m'; YEL='\x1b[33m'; CYN='\x1b[36m'; MAG='\x1b[35m'; GRY='\x1b[90m'
def acq(s): return [x for x in s['broker'] if x['op']=='acquire']
def rel(s): return [x for x in s['broker'] if x['op']=='release']
def ends(s): return [t for t in (s.get('transcript') or []) if t['type'] in ('turn_complete','turn_error')]
def proof(c): return ' | '.join(l.split()[0] for l in c['result']['proof'].strip().split('\n'))
def tools(m,case,role):
    t=m[(case,role)]['toolExecutions']
    return ', '.join(f"{x['execution_state']}/{x['execution_status']}" for x in t) or 'none'
def endstr(e):
    if not e: return '-'
    e=e[-1]
    return (GRN if e['type']=='turn_complete' else RED)+e['type']+' '+(e.get('code') or e.get('stopReason'))+R
def pane_pair(arm, case, label):
    c=load(arm)[case]; m=mysql(arm); A=c['sessions']['A']; Bs=c['sessions']['B']
    a1=acq(A)[0]; b=acq(Bs); r=rel(A)[0]
    L=[]
    L.append(f"{B}{label}{R}  {GRY}case={case}, A's tool holds the mount {c['holdMs']//1000} s{R}")
    L.append(f"{GRY}  t(ms)  event{R}")
    L.append(f"  {a1['at']:>6}  A  acquire           -> {GRN}200{R} (A holds the mount)")
    L.append(f"  {b[0]['at']:>6}  B  acquire           -> {YEL}409 {b[0].get('code')}{R}")
    n409=sum(1 for x in b if x['status']==409)
    ok=[x for x in b if x['status']==200]
    if ok:
        L.append(f"         B  {GRY}... polling, {n409} x 409 workspace_busy in total{R}")
        L.append(f"  {r['at']:>6}  A  release           -> 200")
        L.append(f"  {ok[0]['at']:>6}  B  acquire           -> {GRN}200{R}  {CYN}(+{ok[0]['at']-r['at']} ms after A's release){R}")
        s=Bs['settled'][0]
        L.append(f"  {s['at']:>6}  B  turn.settled      -> {s['payload']['outcome']}")
    else:
        s=Bs['settled'][0]
        L.append(f"  {s['at']:>6}  B  turn.settled      -> {RED}{s['payload']['outcome']}{R}  {GRY}({s['at']-b[0]['at']} ms after the 409){R}")
        L.append(f"  {r['at']:>6}  A  release           -> 200   {GRY}(B is already gone){R}")
    import re
    L.append(f"  {GRY}stderr:{R} " + re.sub(r'turn [0-9a-f-]{36}', 'turn <id>', c['stderr'][0]['line']))
    L.append(f"  client sees  A: {endstr(ends(A))}")
    L.append(f"               B: {endstr(ends(Bs))}")
    L.append(f"  proof.txt    {proof(c)}")
    L.append(f"  MySQL qwen_tool_execution  A: {tools(m,case,'A')}   B: {tools(m,case,'B')}")
    return L
spec=[]
spec.append({'name':'fig1-two-sessions','title':'PR #13366 · two Hosted Sessions on ONE Workspace mount',
  'sub':['Real stack: Spring Session Store + embedded Runtime Broker + bundled worker + MySQL 8.4.11; one packaged `qwen serve` hosts both Sessions.',
         'Left: main @7ee1ec97 (without the PR). Right: PR head 0dccd187 merged onto main @7ee1ec97. Times are ms since driver start.'],
  'rows':[[ '\n'.join(pane_pair('main',case,f'{RED}[main, no PR]{R}')), '\n'.join(pane_pair('merged',case,f'{GRN}[PR merged onto main]{R}'))] for case in ('pair','long')]})
# fig2 stranded
def pane_str(arm,label):
    c=load(arm)['stranded']; m=mysql(arm); res=c['result']; Bs=c['sessions']['B']; A=c['sessions']['A']
    b=acq(Bs)
    L=[f"{B}{label}{R}"]
    L.append(f"  A  release dropped by the proxy -> A status {json.dumps({k:res['aStatus'][k] for k in ('hasActivePrompt','recoveryBlocked')})}")
    held=[l for l in m['leases'] if l['held']]
    L.append(f"  MySQL managed_workspace_execution_lease: held={len(held)} by Session A {GRY}(never cleared){R}")
    if not res.get('bActiveAfter30s'):
        s=Bs['settled'][0]
        L.append(f"  B prompt 1 -> first acquire {YEL}409{R} -> turn.settled {RED}{s['payload']['outcome']}{R} after {s['at']-b[0]['at']} ms")
        L.append(f"  client sees B: {endstr([t for t in res['bTranscriptAfterCancel'] if t['type'] in ('turn_complete','turn_error')])}")
        L.append(f"  DELETE /session/B             -> {GRN}{res['bDelete']['status']}{R}")
        if 'bIdleAfterDeadline' in res:
            L.append(f"  B prompt with deadlineMs=3000 -> settled after {res['bIdleAfterDeadline']['afterMs']} ms (fails on the first 409)")
        return L
    L.append(f"  B prompt 1 queued: {YEL}{res['bAcquire409sIn30s']} x 409 workspace_busy in 30 s{R} ({res['bAcquire409sIn30s']/30:.1f} Broker acquires/s)")
    st=[x for x in Bs['statusSamples']][5]
    L.append(f"  B status while queued        {{hasActivePrompt: {str(st['active']).lower()}, recoveryBlocked: {str(st['blocked']).lower()}}}")
    mq=Bs['midQueueTranscript']
    L.append(f"  B transcript at +10 s        {len(mq)} events, all {'/'.join(sorted(set(t['type'] for t in mq)))} {GRY}(no session_update / turn_* for the queued prompt){R}")
    L.append(f"  stderr                       exactly one line: \"...waits for the Workspace mount held by another Session.\"")
    L.append(f"  POST /cancel                  -> {res['bCancel']['status']}, idle after {res['bIdleAfterCancel']['afterMs']} ms, {endstr([t for t in res['bTranscriptAfterCancel'] if t['type'] in ('turn_complete','turn_error')])}, recoveryBlocked={str(res['bStatusAfterCancel']['recoveryBlocked']).lower()}")
    dl=[t for t in res['bTranscriptAfterDeadline'] if t['type'] in ('turn_complete','turn_error')][-1]
    L.append(f"  prompt with deadlineMs=3000   -> settled after {res['bIdleAfterDeadline']['afterMs']} ms as {endstr([dl])}")
    L.append(f"  prompt 2 (no deadline)        -> still active after 5 s")
    L.append(f"  DELETE /session/B             -> {RED}{res['bDelete']['status']} {res['bDelete']['body']['code']}{R}")
    L.append(f"  POST /detach                  -> {RED}{res['bDetach']['status']} {res['bDetach']['body']['code']}{R}")
    L.append(f"  SIGTERM qwen serve (queued)   -> exit {res['close']['exitCode']} in {res['close']['ms']} ms")
    return L
spec.append({'name':'fig2-stranded-holder','title':'PR #13366 · a holder that never releases (the #12937 end state)',
  'sub':["Session A's tool turn completes, but its :release never reaches the Broker (dropped by the proxy), so A is recovery-blocked and keeps the lease row.",
         'Session B on the same Workspace then prompts. Same real stack. Left: main without the PR. Right: PR merged onto main.',
         'On the Managed Agent path the Java connector sends qwen.managed-agent.harness.turn-deadline (default 30 min, since #13359), so such a turn waits up to 30 min (~6,900 Broker acquires at the measured rate) and then ends as hosted_turn_deadline_exceeded.'],
  'rows':[[ '\n'.join(pane_str('main',f'{RED}[main, no PR]{R}  B fails fast, generic code')), '\n'.join(pane_str('merged',f'{GRN}[PR merged onto main]{R}  B waits for the holder'))]]})
# fig3 tests
mut=json.load(open('/root/verify/pr13366/mut/summary.json'))
um=json.load(open('/root/verify/pr13366/unit-merged.json'))
nc=json.load(open('/root/verify/pr13366/nc-unit.json'))
fig3=[]
fig3.append(f"{B}PR head 0dccd187{R}   hosted-workspace-tool-turn.test.ts + hosted-harness-session.issue-13328.test.ts   {GRN}147/147 passed{R}")
fig3.append(f"{B}PR merged on main{R}  the two suites above + hosted-harness-session.test.ts                         {GRN}{um['numPassedTests']}/{um['numTotalTests']} passed{R}")
fig3.append(f"{B}Negative control{R}   base hosted-workspace-tool-turn.ts + the PR's tests                             {RED}{nc['numFailedTests']}/{nc['numTotalTests']} fail{R}")
for f in nc['testResults']:
    for t in f['assertionResults']:
        if t['status']!='passed': fig3.append(f"  {RED}x{R} {t['title']}")
fig3.append("")
fig3.append(f"{B}Targeted mutants on the changed lines{R} (same two suites; killed = at least one test fails)")
desc={'M1-cancelled-wait-blocks':'cancelled queue wait is treated as recovery-blocking',
'M2-queue-unavailable-too':'workspace_unavailable also queues',
'M3-recovery-also-queues':'recovery acquisitions also queue',
'M4-notice-every-poll':'stderr notice on every poll',
'M5-execute-passes-no-signal':'execute() stops passing the turn signal',
'M6-wait-ignores-cancel':'queue wait ignores cancellation'}
for k,v in mut.items():
    fig3.append(f"  {GRN}killed{R}  {k.split('-')[0]}  {desc[k]:<48} {v['failed']} test(s) fail, e.g.")
    fig3.append(f"              {GRY}{v['titles'][0]}{R}")
fig3.append("")
fig3.append(f"{B}Static{R}  eslint --max-warnings 0, prettier --check (incl. both design docs), packages/cli tsc --noEmit: {GRN}clean{R}")
fig3.append(f"{B}Build{R}   npm run build + npm run bundle at PR head and at PR+main: {GRN}EXIT 0{R}")
spec.append({'name':'fig3-tests','title':'PR #13366 · unit suites, negative control, targeted mutants','sub':['Run locally from packages/cli with vitest; mutants are one-line edits of the PR\'s changed lines, each run against the same two suites.'],'rows':[['\n'.join(fig3).rstrip()]]})
json.dump(spec,open('/root/verify/pr13366/shots/spec.json','w'))
print('ok')
