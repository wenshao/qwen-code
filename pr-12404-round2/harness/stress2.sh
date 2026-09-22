#!/bin/bash
# 14 busy loops on 16 cores, then 40 runs each of the old (main) and new (PR) fixtures; tally the two post-index-change cases.
cd /root/verify/pr12404-r2/packages/cli
PIDS=(); for i in $(seq 1 14); do (while :; do :; done) & PIDS+=($!); done
OUT=/root/verify/pr12404-r2-harness/stress2; mkdir -p $OUT
for i in $(seq 1 40); do
  for arm in old new; do
    npx vitest run src/serve/server/__probe__/$arm --coverage.enabled=false -t "post-index-change" --reporter=json --outputFile=$OUT/$arm-$i.json > /dev/null 2>&1
  done
done
echo "loadavg-during=$(cut -d' ' -f1-3 /proc/loadavg)" > $OUT/load.txt
for p in "${PIDS[@]}"; do kill $p; done
echo DONE > $OUT/done
