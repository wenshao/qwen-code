#!/bin/bash
# PR #13243 round 2 (ee0f4c901c): full regression on ee0f, S2d with Broker capture, S6c on base / f877 / ee0f.
cd /Users/wenshao/pr13129-rig
until grep -q "h43g\] build exit" out/r43/build-h43g.txt 2>/dev/null; do sleep 5; done
grep -q "build exit=0 bundle exit=0" out/r43/build-h43g.txt || { echo "BUILD-FAILED"; exit 1; }
./run-r43.sh h43g r43g s1,s2,s2b,s2c,s3,s4,s5,s7,s6
PROXY=1 ./run-r43.sh h43g r43g2 s2d
PROXY=1 ./run-r43.sh h43g r43g3 s6c
PROXY=1 ./run-r43.sh h43f r43f5 s6c
PROXY=1 ./run-r43.sh b43 r43b3 s6c
echo "R2-ALL-DONE $(date -u +%T)"
