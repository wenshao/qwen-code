#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): build all arms.
R=/Users/wenshao/pr13673-rig
( for a in head base merge main; do $R/build-java.sh $a; done ) > $R/out/java-all.log 2>&1 &
( $R/build-ts.sh base; $R/build-ts.sh main ) > $R/out/ts-all.log 2>&1 &
wait; echo ALL-BUILT $(date -u +%T)
