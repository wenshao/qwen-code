#!/bin/bash
R=/Users/wenshao/pr12964-rig
D="docker run --rm --init --memory=1500m -v $R:/rig -v $R/m2:/root/.m2/repository pr12865-linux"
echo "== $(date +%T) load $(uptime | sed 's/.*averages: //')"
for arm in flakecand3:r2c-margin flakecand2:r2c-poll; do
  $D /rig/run-loop2.sh src-${arm%%:*} ${arm##*:} 60 'TakeoverReconciliationTest#expired*+unavailable*' 2>&1 | tail -1
done
echo "== $(date +%T)"
for f in r2c-margin r2c-poll; do echo "-- $f"; grep -h -E "Test\.[a-zA-Z]+\(|expected" $R/out/$f-failures.txt | sed 's/^run [0-9]*: //' | sort | uniq -c | sort -rn | head -4; done
