#!/bin/bash
# Runs the 'close' scenario in its own node process, then checks — after that
# process has exited — whether worker b and its grandchild survived.
arm=$1; repo=$2; R=$HOME/pr13297-rig/activator
node $R/probe.mjs "$repo" close > $R/runs/$arm-close.log 2>&1
echo "probe rc=$?"
grep RESULT $R/runs/$arm-close.log
pids=$(grep 'RESULT pids' $R/runs/$arm-close.log | sed 's/.*= //')
sleep 3
for k in a a_grandchild b b_grandchild; do
  p=$(node -e "console.log(JSON.parse(process.argv[1])['$k'])" "$pids")
  if kill -0 $p 2>/dev/null; then
    echo "RESULT after_exit_${k}_alive = true (pid $p, ppid $(ps -o ppid= -p $p | tr -d ' '), $(ps -o comm= -p $p))"
    echo $p >> $R/runs/$arm-leftover.pids
  else
    echo "RESULT after_exit_${k}_alive = false"
  fi
done
