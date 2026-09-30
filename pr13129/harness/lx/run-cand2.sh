#!/bin/sh
export PATH=/lx/node-v22.23.2-linux-arm64/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
echo "=== cand2 s5b-lost ws-t9d $(date -u +%T)"
DB=lx ARM=cand2 node s5b-lost.mjs - ws-t9e 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-300
echo "=== repair-by-cand2 of the head leak on ws-t1 $(date -u +%T)"
DB=lx ARM=cand2 MODE=prompt node s2d-delete.mjs ws-t1 a 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-300
echo "=== ALL-DONE $(date -u +%T)"
