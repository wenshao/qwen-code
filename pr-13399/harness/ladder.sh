#!/bin/bash
# Deterministic ladder: the same post-requestToolAction delay (the window the
# main-CI failure landed in) injected into all three arms; local config
# (testTimeout 15s), no retries, no coverage. Usage: ladder.sh <outdir>
OUT=$1; mkdir -p $OUT
cd /root/verify/pr13399/qwen-head/packages/cli
run() { # arm delay
  local log=$OUT/$1-d$2.log
  local t0=$(date +%s%N)
  PR13399_CKPT_DELAY_MS=$2 npx vitest run src/serve/hosted-workspace-tool-turn.$1.test.ts \
    -t 'reports an answer that loses the race to the expiry as expired' --coverage.enabled=false \
    --outputFile.junit=/root/verify/pr13399/tmp/junit-$1-$2.xml > $log 2>&1
  echo "EXIT=$? wall=$(( ($(date +%s%N)-t0)/1000000 ))ms" >> $log
}
for d in 0 800 2000 4000 6000 9000 11000 hang; do
  run armoriginj $d & run armmaininj $d & run armheadinj $d &
  wait
done
