#!/bin/sh
export PATH=/lx/node-v22.23.2-linux-arm64/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
for s in "s2b-lease.mjs ws-t2 b yes SIGKILL" "s2e-reattach.mjs ws-t6b h" "s5b-lost.mjs - ws-t9c"; do
  echo "=== cand2 $s $(date -u +%T)"
  DB=lx ARM=cand2 node $s 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-300
done
echo "=== repair-by-cand2 of the head leak on ws-t1"
DB=lx ARM=cand2 MODE=prompt node s2d-delete.mjs ws-t1 a 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT" | cut -c1-300
echo "=== ALL-DONE $(date -u +%T)"
