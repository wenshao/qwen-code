#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 3): head 6d65c83b, base fe2dd7f6, merge2 = head into main df72e2d1.
R=/Users/wenshao/pr13673-rig
( for a in head base merge2; do $R/build-java.sh $a; done ) > $R/out/java-r3.log 2>&1 &
( for a in head merge2 base; do $R/build-ts.sh $a; done ) > $R/out/ts-r3.log 2>&1 &
wait; echo R3-BUILT $(date -u +%T)
