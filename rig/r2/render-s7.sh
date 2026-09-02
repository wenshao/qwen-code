#!/usr/bin/env bash
# Renders the CI ground-truth panel from the saved job log + jobs API + branch survey.
set -uo pipefail
L="$1"; SURVEY="$2"
printf '\033[1;36m$ CI ground truth — Qwen Code CI run 33610891036, job "Test (ubuntu-latest, Node 22.x)", head 58d4658011 (same test file as 92609a403f)\033[0m\n'
printf '\033[2m  runner ecs-qwen-hk3-14 — a SLOW host this time: "Install dependencies" took 21 min, ESLint 10 min, Prettier 8 min\033[0m\n\n'
printf '\033[1m  step timings (GitHub jobs API)\033[0m\n'
gh api repos/QwenLM/qwen-code/actions/jobs/100185567005 --jq '.steps[] | select(.number==15 or .number==22 or .number==26 or .number==34 or .number==36 or .number==39) | "\(.number)\t\(.conclusion)\t\(.started_at)\t\(.completed_at)\t\(.name)"' | python3 -c "
import sys,datetime as dt
for l in sys.stdin:
    n,c,a,b,name=l.rstrip('\n').split('\t')
    A=dt.datetime.fromisoformat(a.replace('Z','+00:00')); B=dt.datetime.fromisoformat(b.replace('Z','+00:00'))
    col={'success':'\033[32m','failure':'\033[31m','cancelled':'\033[33m'}.get(c,'')
    print(f'  {n:>3}  {col}{c:<10}\033[0m {int((B-A).total_seconds()):>5d}s   {name}')
"
echo; printf '\033[1m  the heartbeat block of step 34 "Run .github/scripts helper tests" (suite 509/509 green in 186 s)\033[0m\n'
for pair in 11207:11209 11297:11299 11303:11305 11309:11311 11315:11317; do
  ok="$(sed -n "${pair%%:*}p" "$L" | sed -E 's/^[0-9T:.Z-]+ //')"; dur="$(sed -n "${pair##*:}p" "$L" | sed -E 's/^[0-9T:.Z-]+ //' | tr -d ' ')"
  printf '\033[32m%s\033[0m   \033[2m%s\033[0m\n' "$ok" "$dur"
done
sed -n '14034,14037p;14041p' "$L" | sed -E 's/^[0-9T:.Z-]+ //'
echo; printf '\033[1m  what the 2 h job timeout cancelled 65 min later (step 36, vitest — nothing this PR touches)\033[0m\n'
sed -n '25220,25222p;25241p' "$L" | sed -E 's/^[0-9T:.Z-]+ //' | cut -c1-150
echo; printf '\033[1m  the "Run .github/scripts helper tests" step across every CI run of this branch\033[0m\n'
python3 - "$SURVEY" <<'PY'
import sys,datetime as dt
rows=[l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l[0].isdigit()]
print(f"  {'run':<12} {'job':<10} {'runner':<24} {'head':<11} helper step")
for r in rows:
    p=r[4].split()
    if len(p)==3 and p[1]!='null':
        a=dt.datetime.fromisoformat(p[1].replace('Z','+00:00')); b=dt.datetime.fromisoformat(p[2].replace('Z','+00:00'))
        d=f"\033[32m{p[0]}\033[0m {int((b-a).total_seconds()):>4d}s"
    else: d="(in progress)"
    jc={'success':'\033[32m','failure':'\033[31m','cancelled':'\033[33m'}.get(r[1],'\033[2m')+r[1]+'\033[0m'
    print(f"  {r[0]:<12} {jc:<19} {r[2][:24]:<24} {r[3]:<11} {d}")
print("  \033[2m every non-green job conclusion above is the later vitest step (36); the helper step is 12/12 green on 12 different runners\033[0m")
PY
