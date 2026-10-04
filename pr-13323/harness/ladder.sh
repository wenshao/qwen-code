#!/bin/bash
# Deterministic delay ladder: the same model-call delay injected into both
# arms (armbaseinj = merge-base file, armheadinj = PR file); default local
# config (testTimeout 15s), no retries, no coverage. Usage: ladder.sh <outdir>
OUT=$1; mkdir -p $OUT
cd /root/verify/pr13323/qwen-head/packages/cli
run() { # arm delay
  local log=$OUT/$1-d$2.log
  local t0=$(date +%s%N)
  PR13323_MODEL_DELAY_MS=$2 npx vitest run src/serve/hosted-harness-session.$1.test.ts \
    -t 'reports and clears the unknown Hook fence' --coverage.enabled=false \
    --outputFile.junit=/root/verify/pr13323/tmp/junit-$1-$2.xml > $log 2>&1
  echo "EXIT=$? wall=$(( ($(date +%s%N)-t0)/1000000 ))ms" >> $log
}
for d in 0 800 1200 3000 9000 11000 hang; do
  run armbaseinj $d & run armheadinj $d &
  wait
done
