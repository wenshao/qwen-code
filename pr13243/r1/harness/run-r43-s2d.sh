#!/bin/bash
# PR #13243: S2d (refused detach -> Broker row) on head f877, ffc4 and base.
cd /Users/wenshao/pr13129-rig
until grep -q "ALL-ARMS-DONE" out/r43/run-all.txt 2>/dev/null; do sleep 5; done
./run-r43.sh h43f r43f3 s2d
./run-r43.sh h43 r43h2 s2d
./run-r43.sh b43 r43b2 s2d
echo "S2D-ARMS-DONE $(date -u +%T)"
