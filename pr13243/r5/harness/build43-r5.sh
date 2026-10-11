#!/bin/bash
# PR #13243 round 5: head 9aa7997816 (h43r) and merge-base d9c6f8c0fe (b43r): pnpm install, TS builds, one jar per arm (head changes Java).
cd /Users/wenshao/pr13243-rig
./install43.sh wt43 > out/install5-wt43.log 2>&1; echo "[wt43] $(tail -1 out/install5-wt43.log)"
./install43.sh wt43b > out/install5-wt43b.log 2>&1; echo "[wt43b] $(tail -1 out/install5-wt43b.log)"
./build-ts.sh wt43 h43r
./build-ts.sh wt43b b43r
./build-java-online.sh j43r /Users/wenshao/pr13243-rig/wt43 /Users/wenshao/pr13243-rig/m2
./build-java-online.sh j43rb /Users/wenshao/pr13243-rig/wt43b /Users/wenshao/pr13243-rig/m2
echo "BUILD-R5-DONE $(date -u +%T)"
