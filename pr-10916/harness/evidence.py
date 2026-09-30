import json, os, sys
R='/root/verify/pr10916/runs'
B='\033[1m'; D='\033[2m'; G='\033[32m'; Rd='\033[31m'; Y='\033[33m'; C='\033[36m'; M='\033[35m'; X='\033[0m'
def load(d): return [json.loads(l) for l in open(f'{R}/{d}/requests.jsonl')]
def tail(d, f):
    p=f'{R}/{d}/{f}'
    lines=[l for l in open(p).read().splitlines() if l.strip() and not l.startswith('Warning: running headless')]
    return lines[-1] if lines else '(empty)'
def arm_line(d):
    reqs=load(d); ex=open(f'{R}/{d}/exit_code').read().strip()
    rounds=sum(1 for r in reqs if r['kind']=='main')
    out=tail(d,'stdout.txt'); err=tail(d,'stderr.txt')
    msg = out if out!='(empty)' else err
    col = G if ex=='0' else Rd
    return rounds, ex, col, msg
which=sys.argv[1]
if which=='headless':
    print(f"{B}PR #10916 · headless A/B · scripted fake model, real shell/git, qwen -p{X}")
    print(f"{D}main = origin/main 51b80dadbc   pr = 965900af merged with 51b80dadbc (cd4c24b129)   all runs --approval-mode yolo{X}")
    print(f"{D}request counts on arms that finish normally include one trailing managed-memory extraction request{X}\n")
    rows=[('S1','s1','issue shape: varied git cmds; the first three fail with the same exit-128; reads between'),
          ('S1x','v2-s1x-list-directory','S1 with one call to the default-disabled list_directory (a different error) mid-streak'),
          ('S5b','v2-s5b-blocked-sleep','S1 with one `sleep 6; git …` call refused by the shell tool (a different error) mid-streak'),
          ('S2','v2-s2-alternating','two dead ends alternating round by round, 16 error rounds'),
          ('S3b','v2-s3b-deny-rule','shell declared, user deny rule run_shell_command(npm *): 3 denials spread over a run'),
          ('S4','s4','edit -> re-run loop: 2 unsuccessful edits, the 3rd would fix'),
          ('S7','s7','3 DIFFERENT failures whose output quotes a digest line'),
          ('S8','s8','productive review in a git repo: 3 silent exit-1 probes (git diff --quiet / command -v)')]
    for tag,s,desc in rows:
        print(f"{C}{B}{tag}{X} {desc}")
        for arm in ['main','pr']:
            if tag=='S1x' and arm=='pr':
                n,ex,col,msg=arm_line(f'{s}-{arm}-2')
            else:
                n,ex,col,msg=arm_line(f'{s}-{arm}')
            if len(msg)>112: msg=msg[:109]+'...'
            print(f"   {arm:<4} model requests={n:<3} exit={col}{ex}{X}  {D}{msg}{X}")
        print()
    print(f"{C}{B}S1/ACP{X} same S1 script through a real `qwen --acp` stdio session (IDE / daemon runtime)")
    for arm in ['main','pr']:
        r=json.load(open(f'{R}/acp-s1-{arm}/result.json'))
        print(f"   {arm:<4} model requests={r['modelRequests']:<3} stopReason={r['stopReason']}  tool calls={r['toolCalls']}  {D}{r['lastAgentText'][-60:]}{X}")
    print()
elif which=='steer':
    print(f"{B}PR #10916 · R6-1 · mid-turn steer typed while the halting round's command runs (real TUI){X}\n")
    for arm,label in [('main','main (no halt)'),('pr','pr (halt)'),('fix','pr + patch B (halt)'),('fix2','pr + patch A (halt)')]:
        reqs=load(f'tui-s5-{arm}')
        counts=[json.dumps(r['messages']).count('STEER-MARKER-42') for r in reqs if r['kind']=='main']
        mx=max(counts); col = G if mx==1 else Rd
        print(f"  {label:<24} steer text occurrences per model request → {col}{counts}{X}")
    print(f"  {D}patch B (recommended) = keep the write, settle the attached carrier as accepted, as the normal send path does{X}")
    print(f"  {D}patch A = write only functionResponse parts (carrier restored and re-sent once) — drops steer for OpenTUI, which sends no carrier{X}")
    print()
    reqs=load('tui-s5-pr')
    r=[r for r in reqs if r['kind']=='main' and 'STEER-MARKER-42' in json.dumps(r['messages'])][0]
    print(f"{B}pr: first request after the loop dialog (request #{r['idx']}), last 3 messages:{X}")
    for m in r['messages'][-3:]:
        c=m.get('content'); 
        if isinstance(c,list):
            for k,p in enumerate(c):
                t=p.get('text','').replace(chr(10),' ⏎ ')
                hl = Y if 'STEER' in t else D
                role = m['role'] + (f' part{k+1}' if len(c)>1 else '')
                print(f"  {M}{role:<11}{X} {hl}{t[:118]}{X}")
        else:
            print(f"  {M}{m['role']:<11}{X} {D}{str(c).replace(chr(10),' ⏎ ')[:118]}{X}")
