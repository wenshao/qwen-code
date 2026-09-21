#!/bin/bash
H=/root/git/h12374-e2e; C='\e[1;36m'; N='\e[0m'; R='\e[31m'; G='\e[32m'
printf "${C}# 1. ambient QWEN_RUNTIME_DIR=<sentinel> exported, housekeeping suites run as uid 1500 (R1-6/R1-7)${N}\n"
printf "#    same PR-head production code in both runs; only the two test files differ\n"
awk '/^== /{arm=$2} /Tests +[0-9]/{sub(/^ +Tests +/,""); t[arm]=$0} /sentinel after/{sub(/sentinel after: +/,""); n=split($0,a," "); s[arm]=n" of 5 left"} END{printf "   %-24s %-30s %s\n","test files","vitest","sentinel (5 files seeded)"; printf "   %-24s %-30s \033[31m%s\033[0m\n","b83983c19 (round 2)",t["r2-tests"],s["r2-tests"]; printf "   %-24s %-30s \033[32m%s\033[0m\n","81fecd5f (this round)",t["r3-tests"],s["r3-tests"]}' $H/out/ambient-ab.txt
printf "\n${C}# 2. mutation matrix, round-3 claims (uid 1500, cleanup.test.ts + scheduler.test.ts)${N}\n"
python3 - <<'PY'
import json
rows=json.load(open('/root/git/h12374-e2e/out/mutants.json'))
def c(v):
    if v is None: return '\x1b[2m' + 'not run'.ljust(14) + '\x1b[0m'
    return ('\x1b[32m' + f"killed ({v['failed']})".ljust(14) if v['killed'] else '\x1b[31m' + 'survived'.ljust(14)) + '\x1b[0m'
print(f"   {'id':6} {'mutant':56} {'r2 tests':14} {'r3 tests':14}")
for r in rows:
    print(f"   {r['id']:6} {r['desc'][:56]:56} {c(r.get('b83983c19'))} {c(r.get('r3'))}")
PY
printf "\n${C}# 3. same suites, Linux${N}\n"
printf "   uid 1500 (non-root)         : ${G}65 passed (65)${N}\n"
printf "   uid 0 (root), main          : %s\n" "$(grep -E '^ +Tests ' $H/out/root-base.txt | sed 's/^ *Tests *//')"
printf "   uid 0 (root), PR            : %s  # chmod EACCES cases (root)\n" "$(grep -E '^ +Tests ' $H/out/root-pr.txt | sed 's/^ *Tests *//')"
