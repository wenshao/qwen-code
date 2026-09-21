#!/bin/bash
H=/root/git/h12374-e2e; C='\e[1;36m'; N='\e[0m'
short() { sed -E 's/^([^ ]+ +[0-9]+ +root +root)//'; }
printf "${C}# S2 — real \`qwen serve\` with QWEN_DEBUG_LOG_FILE=1: the allowlisted name is a real daemon file${N}\n"
printf '$ ls -la runtime/debug\n'; (cd $H/sc/s2/runtime/debug && ls -la --time-style=+%T . | tail -n +4 | short)
printf '$ head -2 runtime/debug/workspace-mcp-discovery.txt\n'; head -2 $H/sc/s2/runtime/debug/workspace-mcp-discovery.txt | cut -c1-90
printf "\n${C}# S2 — copy of that dir; *.txt aged 45 d (pr, base) or left fresh; then an idle interactive TUI${N}\n"
python3 - <<'PY'
import json
H='/root/git/h12374-e2e/out'
arms=[('s2-base','base, 45 d'),('s2-pr','PR, 45 d'),('s2-fresh','PR, fresh')]
B={a:{e['name']:e for e in json.load(open(f'{H}/{a}-before.json'))['debug']} for a,_ in arms}
A={a:{e['name']:e for e in json.load(open(f'{H}/{a}-after.json'))['debug']} for a,_ in arms}
print(f"{'entry':44}"+''.join(f'{l:>14}' for _,l in arms))
for n in sorted(B['s2-pr']):
    row=[]
    for a,_ in arms:
        e=A[a].get(n)
        row.append('\x1b[31mREMOVED\x1b[0m' if e is None else ('dangling' if e['kind']=='symlink' and not e['target_exists'] else 'kept'))
    print(f"{n:44}"+''.join(' '*(14-len(r.replace('\x1b[31m','').replace('\x1b[0m','')))+r for r in row))
PY
printf "\n${C}# S4 — restart the daemon 3x, no client requests: appended once per start, never rotated${N}\n"
printf '$ for i in 1 2 3; do restart qwen serve; stat -c %%s workspace-mcp-discovery.txt; done\n'; cat $H/out/s4-restarts.txt
printf "\n${C}# S4 — daemon still running, file mtime 2 h old, TUI with cleanupPeriodDays: 0${N}\n"
python3 - <<'PY'
import json
b={e['name'] for e in json.load(open('/root/git/h12374-e2e/out/s4-before.json'))['debug']}
a={e['name'] for e in json.load(open('/root/git/h12374-e2e/out/s4-after-sweep.json'))['debug']}
print('removed by the sweep:', sorted(b-a)); print('kept:', len([x for x in a if x.endswith('.txt')]), 'session logs (fresh), daemon/, latest')
PY
printf '$ curl /health ; POST /session/:id/prompt   # afterwards\n{"status":"ok"} HTTP 200 ; {"promptId":"37b54c08-…"} HTTP 202\n'
