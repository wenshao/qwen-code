#!/bin/bash
# PR #13136 verification: build both arms. TS and Java run as two parallel lanes; within a lane, sequential.
R=/Users/wenshao/pr13129-rig
( $R/build-ts.sh wt36 pr36; $R/build-ts.sh wt36b base36 ) > $R/out/build36-ts.log 2>&1 &
( $R/build-java.sh pr36 $R/wt36 $R/m2-head; $R/build-java.sh base36 $R/wt36b $R/m2-head ) > $R/out/build36-java.log 2>&1 &
wait
echo ALL-BUILDS-DONE
cat $R/out/build36-ts.log $R/out/build36-java.log
