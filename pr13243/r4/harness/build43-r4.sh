#!/bin/bash
# PR #13243 round 4: head f72edd01e6 (h43p) and merge-base 5ddd43815b (b43m): pnpm install, TS builds, one jar per arm (head changes Java).
cd /Users/wenshao/pr13243-rig
./install43.sh wt43 > out/install-wt43.log 2>&1; echo "[wt43] $(tail -1 out/install-wt43.log)"
./install43.sh wt43b > out/install-wt43b.log 2>&1; echo "[wt43b] $(tail -1 out/install-wt43b.log)"
./build-ts.sh wt43 h43p
./build-ts.sh wt43b b43m
./build-java-online.sh j43p /Users/wenshao/pr13243-rig/wt43 /Users/wenshao/pr13243-rig/m2
./build-java-online.sh j43m /Users/wenshao/pr13243-rig/wt43b /Users/wenshao/pr13243-rig/m2
echo "BUILD-R4-DONE $(date -u +%T)"
