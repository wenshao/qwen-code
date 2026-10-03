import json, os, re, sys
R='/root/verify/pr10916/r3/runs'
B='\033[1m'; D='\033[2m'; G='\033[32m'; Rd='\033[31m'; Y='\033[33m'; C='\033[36m'; X='\033[0m'
HEAD='72f3d0ae04 merged with main bfb32c780d'
def load(d): return [json.loads(l) for l in open(f'{R}/{d}/requests.jsonl')]
def flat(c): return c if isinstance(c,str) else ''.join(p.get('text','') for p in c) if isinstance(c,list) else ''
def lastline(d, f):
    p=f'{R}/{d}/{f}'
    if not os.path.exists(p): return ''
    lines=[l for l in open(p).read().splitlines() if l.strip() and not l.startswith('Warning: running headless')]
    return lines[-1] if lines else ''
def headless(d):
    reqs=load(d); ex=open(f'{R}/{d}/exit_code').read().strip()
    n=sum(1 for r in reqs if r['kind']=='main')
    msg=lastline(d,'stdout.txt') or lastline(d,'stderr.txt') or '(no output)'
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
def line(arm, n, ex, msg, w=100):
    col = G if ex=='0' else Rd
    if len(msg)>w: msg=msg[:w-3]+'...'
    return f"   {arm:<22} requests={n:<3} exit={col}{ex}{X}  {D}{msg}{X}"
def s12(d):
    reqs=load(d)
    cont=[r for r in reqs if r['kind']=='sub' and 'STOPHOOK-CONTINUE' in json.dumps(r['messages'][-1])][0]
    msgs=cont['messages']
    tr={m['tool_call_id']:flat(m['content']) for m in msgs if m.get('role')=='tool'}
    return msgs[-2]['role']=='tool', tr
which=sys.argv[1]
if which=='r71':
    print(f"{B}PR #10916 · round 3 · R7-1 at the new head (S12): subagent halted by the guard, then a SubagentStop hook continues it{X}")
    print(f"{D}subagent rounds: git log (exit 128) -> git status (exit 128) -> [write_file notes.txt + git branch -a (exit 128)] = guard halts{X}")
    print(f"{D}user hook hooks.SubagentStop blocks once ('confirm that notes.txt was saved') -> runSubagentStopHookLoop sends on the SAME chat{X}")
    print(f"{D}below: the tool responses paired with the halting round's two calls, as sent to the model in that continuation request{X}\n")
    for arm,d,lab in [('main','s12-stophook-r71__main','origin/main bfb32c780d (no guard; the subagent finishes normally)'),
                      ('pr (new head)','s12-stophook-r71__pr-rep1',HEAD),
                      ('pr, hunk removed','s12-stophook-r71__mut-r71','negative control: copy of the built bundle with only the 72f3d0ae04 agent-core hunk removed')]:
        halted,tr=s12(d)
        print(f"{C}{B}{arm}{X}  {D}{lab}{X}")
        for cid,name in [('call_s2_write','write_file notes.txt'),('call_s2_git','git branch -a       ')]:
            c=tr.get(cid,'')
            first=c.split('\n')[0] if ('not recorded' in c or 'Successfully' in c) else ' / '.join(c.split('\n')[:3])
            first=re.sub(r'/root/verify/pr10916/r3/runs/[^/]+/ws/', '<ws>/', first)
            if len(first)>112: first=first[:109]+'...'
            print(f"   {name}  {(Rd if 'not recorded' in c else G)}{first}{X}")
        ws=f'{R}/{d}/ws/notes.txt'
        disk=open(ws).read().strip() if os.path.exists(ws) else '(missing)'
        print(f"   {D}on disk: notes.txt = \"{disk}\"{X}\n")
    rows=[]
    for d in sorted(os.listdir(R)):
        if d.startswith('s12-stophook-r71__pr-'):
            halted,tr=s12(d)
            glitch=any('Output: (empty)' in v for v in tr.values())
            real=('Successfully' in tr.get('call_s2_write','')) and ('not recorded' not in tr.get('call_s2_git',''))
            rows.append((d.split('__')[1],halted,glitch,real))
    h=[r for r in rows if r[1]]
    print(f"{B}All {len(rows)} pr runs:{X} {G}{len(h)} halted by the guard, and all {sum(1 for r in h if r[3])} carry the real results{X}; "
          f"{D}{len(rows)-len(h)} did not halt (the pre-existing 'Output: (empty)' glitch hit round 2 and reset the streak){X}")
    print(f"{B}Negative control:{X} {Rd}2 of 2 runs halted and carry the orphan-repair text{X}")
elif which=='headless':
    print(f"{B}PR #10916 · round 3 · headless A/B @ {HEAD}{X}")
    print(f"{D}scripted fake model; real shell, git, file tools, stdio MCP server, background agents; every run: qwen -p --approval-mode yolo{X}")
    print(f"{D}requests = main-conversation model requests (a normal finish includes one trailing memory-extraction request){X}\n")
    print(f"{G}{B}Closed in round 2, re-run at the new head{X}")
    print(f"{C}{B}S9-distinct{X} R11-1 · MCP gateway: 3 DIFFERENT upstream failures, all ending '... with response: 502 Bad Gateway'")
    for arm,d in [('main','s9-mcp-distinct__main'),('pr','s9-mcp-distinct__pr')]: print(line(arm,*headless(d)))
    print(f"{C}{B}S13{X} R11-2 · background agent: 2 identical errors -> answers -> send_message starts a new prompt -> 1 more")
    for arm,d in [('main','s13-bg-drain-r112__main'),('pr','s13-bg-drain-r112__pr')]:
        st,res=bg_outcome(d); col=G if st=='completed' else Rd
        print(f"   {arm:<22} background agent: {col}{st}{X}  {D}{res[:80]}{X}")
    print(f"\n{G}{B}Still fires where it should (positive controls){X}")
    print(f"{C}{B}S1{X} issue shape: varied git commands, the same exit-128 error, reads in between")
    print(line('main',*headless('s1-git-deadend__main')))
    for t in ['rep2','rep3','rep4']: print(line(f'pr ({t})',*headless(f's1-git-deadend__pr-{t}')))
    print(f"   {D}first pr run: the 'Output: (empty)' glitch hit the 3rd git call, which reset the streak (14 requests, same as main){X}")
    print(f"{C}{B}S9-same{X} MCP dead end: varied args, one byte-identical upstream error")
    for arm,d in [('main','s9-mcp-same__main'),('pr','s9-mcp-same__pr')]: print(line(arm,*headless(d)))
    print(f"\n{Y}{B}Still open: productive headless runs end with exit 1 and no answer (round-1 item 2){X}")
    for tag,s,desc in [('S3b','s3b-deny-rule','user deny rule run_shell_command(npm *): 3 denials spread over a run'),
                       ('S8','s8-probes','review in a git repo: 3 silent exit-1 probes (git diff --quiet x2, command -v yq)'),
                       ('S4','s4-edit-retry','edit -> re-run loop: 2 unsuccessful edits, the 3rd would fix'),
                       ('S10','s10-timeouts','3 DIFFERENT commands, each hits the same 3000 ms shell timeout')]:
        print(f"{C}{B}{tag}{X} {desc}")
        for arm in ['main','pr']: print(line(arm,*headless(f'{s}__{arm}')))
