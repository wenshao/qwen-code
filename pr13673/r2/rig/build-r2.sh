#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 2): merge2 (head into main 1f4484d3) + main2 control.
R=/Users/wenshao/pr13673-rig
( for a in merge2 main2; do $R/build-java.sh $a; done ) > $R/out/java-r2.log 2>&1 &
( $R/build-ts.sh main2 ) > $R/out/ts-r2.log 2>&1 &
wait; echo R2-BUILT $(date -u +%T)
