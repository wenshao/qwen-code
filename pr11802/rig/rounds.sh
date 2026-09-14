#!/bin/bash
# extra determinism rounds: restart both daemons, run S1 on both arms, repeat
SCR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/45462301-d8d9-4c6c-9415-3e65177a390f/scratchpad
cd $SCR
for R in 4 5; do
  pkill -f "$SCR/wt-head/dist/cli.js serve"; pkill -f "$SCR/wt-base/dist/cli.js serve"; sleep 2
  mkdir -p runs/r$R
  (nohup bash rig/run-daemon.sh head $SCR/wt-head 8801 8765 tok11802 > /dev/null 2>&1 &)
  (nohup bash rig/run-daemon.sh base $SCR/wt-base 8802 8766 tok11802 > /dev/null 2>&1 &)
  for p in 8801 8802; do for i in $(seq 1 40); do curl -s -m 2 "http://127.0.0.1:$p/health?deep=1" -H "Authorization: Bearer tok11802" 2>/dev/null | grep -q '"status":"ok"' && break; sleep 1; done; done
  node rig/driver.mjs --port 8801 --token tok11802 --arm head --out $SCR/runs/r$R --scenario s1 --wait 30 --siblings 2 --ws $SCR/env-head/ws > runs/r$R/driver-head.log 2>&1
  node rig/driver.mjs --port 8802 --token tok11802 --arm base --out $SCR/runs/r$R --scenario s1 --wait 30 --siblings 2 --ws $SCR/env-base/ws > runs/r$R/driver-base.log 2>&1
  echo "round $R done"
done
echo ROUNDS_DONE
