#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 4): merge3 = head 6d65c83b into main fce50611 (0aa2f8c9).
R=/Users/wenshao/pr13673-rig
$R/build-java.sh merge3 > $R/out/java-r4.log 2>&1 &
$R/build-ts.sh merge3 > $R/out/ts-r4.log 2>&1 &
wait; echo R4-BUILT $(date -u +%T)
