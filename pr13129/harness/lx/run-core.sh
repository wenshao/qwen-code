#!/bin/sh
# VERIFICATION RIG ONLY: replay the platform-independent scenarios on the Linux stack (new head jar), sequentially.
export PATH=/lx/node-v22.23.2-linux-arm64/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
for s in "s2b-lease.mjs ws-t1 a yes SIGTERM" "s2b-lease.mjs ws-base2 m no SIGTERM" "s2c-after.mjs ws-t1:a ws-base2:m" "s1-permission.mjs" "s3-catalog.mjs" "s4-prompt.mjs" "s5b-lost.mjs ws-t4b ws-t9b"; do
  echo "=== $s $(date -u +%T)"
  DB=lx TAG=lx node $s 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-360
done
echo "=== ALL-DONE $(date -u +%T)"
