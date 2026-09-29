#!/bin/bash
R=/Users/wenshao/pr12964-rig
D="docker run --rm --init --memory=1500m -v $R:/rig -v $R/m2:/root/.m2/repository pr12865-linux"
echo "== $(date +%T) load $(uptime | sed 's/.*averages: //')"
for arm in merge2:r2b-orig flakecand2:r2b-poll flakecand3:r2b-margin; do
  $D /rig/run-loop2.sh src-${arm%%:*} ${arm##*:} 20 'TakeoverReconciliationTest#expired*+unavailable*' 2>&1 | tail -1
done
echo "== $(date +%T)"
for f in r2b-orig r2b-poll r2b-margin; do echo "-- $f"; sed 's/ -- Time elapsed.*//' $R/out/$f-failures.txt | sort | uniq -c | sort -rn | head -6; done
