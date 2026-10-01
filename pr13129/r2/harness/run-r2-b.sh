#!/bin/bash
# Round 2: reruns with session-filtered ledgers + catalog-only (expectedRevision 0) + regression set.
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
run() { echo "=== $* $(date -u +%T)"; env DB=r2 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-330; }
run ARM=head4 node s5b-lost.mjs - ws-t9c
run ARM=head4 ARM2=head4 node s2f-catalog-only.mjs ws-f1d
run ARM=head3 ARM2=head4 node s2f-catalog-only.mjs ws-f1b
run ARM=head4 node s1-permission.mjs
run ARM=head4 node s3-catalog.mjs
run ARM=head4 node s4-prompt.mjs
run ARM=head4 node s6-limits.mjs
run ARM=head4 node s8-secrets.mjs
run ARM=head4 node s10-baseline.mjs
echo "=== ALL-DONE $(date -u +%T)"
