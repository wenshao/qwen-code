#!/bin/bash
# PR #13135 round 2: deps + build head2 (d7c5c5e50e) and base2 (49b6c90053).
R=/Users/wenshao/pr13135-rig
( $R/setup-deps.sh wt2; $R/build-ts.sh wt2 head2 ) > $R/out/lane-ts-head2.log 2>&1 &
( $R/setup-deps.sh wt2-main; $R/build-ts.sh wt2-main base2 ) > $R/out/lane-ts-base2.log 2>&1 &
( $R/build-java.sh head2 $R/wt2 $R/m2; $R/build-java.sh base2 $R/wt2-main $R/m2 ) > $R/out/lane-java2.log 2>&1 &
wait
echo ALL-BUILDS-DONE $(date -u +%T)
cat $R/out/lane-*2.log; tail -1 $R/out/setup-wt2*.log
