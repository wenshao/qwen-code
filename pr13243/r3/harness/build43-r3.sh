#!/bin/bash
# PR #13243 round 3: head be10a118a1 (h43h), new merge-base 6136786c0c (b43n), jar from the merge-base (Java identical in head).
cd /Users/wenshao/pr13129-rig
./build-ts.sh wt43 h43h
./build-ts.sh wt43b b43n
./build-java-online.sh j43n /Users/wenshao/pr13129-rig/wt43b /Users/wenshao/pr13129-rig/m2-head
echo "BUILD-R3-DONE $(date -u +%T)"
