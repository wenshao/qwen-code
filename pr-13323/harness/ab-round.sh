#!/bin/bash
# One A/B round: base arm (merge-base file, unmodified) vs head arm (PR file,
# unmodified) at each CPU quota, all six in parallel. Usage: ab-round.sh <round>
R=$1; OUT=/root/verify/pr13323/runs/ab; mkdir -p $OUT
H=/root/verify/pr13323/harness/throttle-run.sh
for q in 5 3 2; do
  $H $q src/serve/hosted-harness-session.armbase.test.ts $OUT/base-q$q-r$R.log &
  $H $q src/serve/hosted-harness-session.test.ts $OUT/head-q$q-r$R.log &
done
wait
