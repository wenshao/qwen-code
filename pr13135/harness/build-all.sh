#!/bin/bash
# PR #13135: deps + build both arms. TS and Java lanes in parallel.
R=/Users/wenshao/pr13135-rig
( $R/setup-deps.sh wt; $R/build-ts.sh wt head ) > $R/out/lane-ts-head.log 2>&1 &
( $R/setup-deps.sh wt-main; $R/build-ts.sh wt-main base ) > $R/out/lane-ts-base.log 2>&1 &
( $R/build-java.sh head $R/wt $R/m2; $R/build-java.sh base $R/wt-main $R/m2 ) > $R/out/lane-java.log 2>&1 &
wait
echo ALL-BUILDS-DONE $(date -u +%T)
cat $R/out/lane-*.log; tail -2 $R/out/setup-*.log
