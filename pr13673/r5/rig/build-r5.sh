#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 5, post-merge): landed = squash 7cbb993c on main (parent 78a1d33a).
R=/Users/wenshao/pr13673-rig
$R/build-java.sh landed > $R/out/java-r5.log 2>&1 &
$R/build-ts.sh landed > $R/out/ts-r5.log 2>&1 &
wait; echo R5-BUILT $(date -u +%T)
