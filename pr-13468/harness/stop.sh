#!/usr/bin/env bash
# stop.sh <arm> : kill the listener PIDs on this arm's ports, then any ACP
# children whose command line names this arm's cli.js AND whose env points at
# this arm's run dir (explicit PIDs only; never pkill -f).
arm=$1; if [ $arm = base ]; then FP=18466; DP=18470; else FP=18467; DP=18471; fi
for port in $DP $FP; do
  for p in $(ss -ltnpH "sport = :$port" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill -TERM $p 2>/dev/null; done
done
sleep 2
for p in $(ps -eo pid,args | grep "[/]root/verify/pr13468/head/arms/$arm/cli.js" | awk '{print $1}'); do
  grep -qz "QWEN_HOME=/root/verify/pr13468/runs/$arm/" /proc/$p/environ 2>/dev/null && kill -TERM $p 2>/dev/null
done
sleep 1
