import json, os, re, sys
R='/root/verify/pr10916/r2/runs'
B='\033[1m'; D='\033[2m'; G='\033[32m'; Rd='\033[31m'; Y='\033[33m'; C='\033[36m'; M='\033[35m'; X='\033[0m'
def load(d): return [json.loads(l) for l in open(f'{R}/{d}/requests.jsonl')]
def lastline(d, f):
    p=f'{R}/{d}/{f}'
    if not os.path.exists(p): return ''
    lines=[l for l in open(p).read().splitlines() if l.strip() and not l.startswith('Warning: running headless')]
    return lines[-1] if lines else ''
def headless(d):
    reqs=load(d); ex=open(f'{R}/{d}/exit_code').read().strip()
    n=sum(1 for r in reqs if r['kind']=='main')
    out=lastline(d,'stdout.txt'); err=lastline(d,'stderr.txt')
    msg=out or err or '(no output)'
    if msg.startswith('Loop detection halted'): msg='Loop detection halted the run (repeated_tool_error ...) — no answer'
    return n, ex, msg
def bg_outcome(d):
    st=''; res=''
    for r in load(d):
        for m in r['messages']:
            c=m.get('content'); c=c if isinstance(c,str) else json.dumps(c)
            mm=re.search(r'<status>([^<]+)</status>', c)
            if 'task-notification' in c and mm:
                st=mm.group(1); rr=re.search(r'<result>(.*?)</result>', c, re.S); res=(rr.group(1) if rr else '').replace('\\n',' ')
    return st, res
def line(arm, n, ex, msg, w=104):
    col = G if ex=='0' else Rd
    if len(msg)>w: msg=msg[:w-3]+'...'
    return f"   {arm:<20} requests={n:<3} exit={col}{ex}{X}  {D}{msg}{X}"
which=sys.argv[1]
if which=='headless':
    print(f"{B}PR #10916 · round 2 · headless A/B @ 3fb6a1f042 (merged with main a011f66944){X}")
    print(f"{D}scripted fake model; real shell, git, file tools, stdio MCP server, background agents; every run: qwen -p --approval-mode yolo{X}")
    print(f"{D}requests = main-conversation model requests (a normal finish includes one trailing memory-extraction request){X}\n")
    print(f"{G}{B}Fixed since round 1 — each with a negative control (fix reverted in a copy of the built bundle){X}")
    print(f"{C}{B}S9-distinct{X} R11-1 · MCP gateway: 3 DIFFERENT upstream failures, all ending '... with response: 502 Bad Gateway'")
    for arm,d in [('main','s9-mcp-distinct__main'),('pr','s9-mcp-distinct__pr'),('pr, lastIndexOf back','s9-mcp-distinct__mut-r11-1')]:
        print(line(arm,*headless(d)))
    print(f"{C}{B}S13{X} R11-2 · background agent: 2 identical errors -> answers -> send_message starts a new prompt -> 1 more")
    for arm,d in [('main','s13-bg-drain-r112__main'),('pr','s13-bg-drain-r112__pr'),('pr, drain clear removed','s13-bg-drain-r112__mut-r11-2')]:
        st,res=bg_outcome(d); col=G if st=='completed' else Rd
        print(f"   {arm:<24} background agent: {col}{st}{X}  {D}{res[:80]}{X}")
    print(f"\n{G}{B}Still works (positive controls){X}")
    print(f"{C}{B}S1{X} issue shape: varied git commands, the same exit-128 error, reads in between")
    for arm,d in [('main','s1-git-deadend__main'),('pr','s1-git-deadend__pr')]: print(line(arm,*headless(d)))
    print(f"{C}{B}S9-same{X} MCP dead end: varied args, one byte-identical upstream error")
    for arm,d in [('main','s9-mcp-same__main'),('pr','s9-mcp-same__pr')]: print(line(arm,*headless(d)))
    print(f"\n{Y}{B}Still open: productive headless runs end with exit 1 and no answer (round-1 item 2){X}")
    for tag,s,desc in [('S3b','s3b-deny-rule','user deny rule run_shell_command(npm *): 3 denials spread over a run'),
                       ('S8','s8-probes','review in a git repo: 3 silent exit-1 probes (git diff --quiet x2, command -v yq)'),
                       ('S4','s4-edit-retry','edit -> re-run loop: 2 unsuccessful edits, the 3rd would fix'),
                       ('S10','s10-timeouts','R1-1 entrance B, first real run · 3 DIFFERENT commands, each hits the same 3000 ms shell timeout')]:
        print(f"{C}{B}{tag}{X} {desc}")
        for arm in ['main','pr']: print(line(arm,*headless(f'{s}__{arm}')))
elif which=='r71':
    print(f"{B}PR #10916 · round 2 · R7-1 end to end (S12): subagent halted by the guard, then a SubagentStop hook continues it{X}")
    print(f"{D}subagent rounds: git log (exit 128) -> git status (exit 128) -> [write_file notes.txt + git branch -a (exit 128)] = guard halts{X}")
    print(f"{D}user hook  hooks.SubagentStop: blocks once with 'confirm that notes.txt was saved' -> runSubagentStopHookLoop sends on the SAME chat{X}")
    print(f"{D}below: the tool responses paired with the halting round's two calls, as sent to the model in that continuation request{X}\n")
    for arm,d,lab in [('main','s12-stophook-r71__main','origin/main a011f66944 (no guard; the subagent finishes normally)'),
                      ('pr','s12-stophook-r71__pr','3fb6a1f042 merged with main'),
                      ('pr + fix','s12-stophook-r71__fix','pr + harness/fix-r7-1-agent-history.patch')]:
        reqs=load(d)
        cont=[r for r in reqs if r['kind']=='sub' and 'STOPHOOK-CONTINUE' in json.dumps(r['messages'][-1])][0]
        print(f"{C}{B}{arm}{X}  {D}{lab}{X}")
        for m in cont['messages']:
            if m['role']=='tool' and m.get('tool_call_id') in ('call_s2_write','call_s2_git'):
                c=m['content'] if isinstance(m['content'],str) else ''.join(p.get('text','') for p in m['content'])
                first=c.split('\n')[0] if 'not recorded' in c or 'Successfully' in c else ' / '.join(c.split('\n')[:3])
                bad='not recorded' in c
                col = Rd if bad else G
                name='write_file notes.txt' if m['tool_call_id']=='call_s2_write' else 'git branch -a       '
                first=re.sub(r'/root/verify/pr10916/r2/runs/[^/]+/ws/', '<ws>/', first)
                if len(first)>118: first=first[:115]+'...'
                print(f"   {name}  {col}{first}{X}")
        ws=f'{R}/{d}/ws/notes.txt'
        disk=open(ws).read().strip() if os.path.exists(ws) else '(missing)'
        print(f"   {D}on disk: notes.txt = \"{disk}\"{X}\n")
    print(f"{D}pr: the model is told that a write which succeeded was lost to a crash and should be retried.{X}")
    print(f"{D}The client-side halt already records its round (client.ts); the agent-runtime halt (agent-core.ts) does not.{X}")
