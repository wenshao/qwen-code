#!/bin/bash
# Round 2 (39de410325): F1 matrix on macOS, DB r2. Sequential.
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
run() { echo "=== $* $(date -u +%T)"; env DB=r2 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-330; }
run ARM=head4 node s2b-lease.mjs ws-t9d t yes SIGTERM
run ARM=head4 node s2b-lease.mjs ws-t2 b yes SIGKILL
run ARM=head4 node s2b-lease.mjs ws-base2 m no SIGTERM
run ARM=head4 node s2e-reattach.mjs ws-t6b h
run ARM=head4 node s5b-lost.mjs ws-t4b ws-t9b
run ARM=head4 ARM2=head4 node s2f-catalog-only.mjs ws-f1a
run ARM=head3 ARM2=head4 node s2f-catalog-only.mjs ws-f1b
run ARM=head3 ARM2=head4 node s2b-lease.mjs ws-f1c g2 yes SIGTERM
run ARM=head4 node s5-lost.mjs
echo "=== ALL-DONE $(date -u +%T)"
