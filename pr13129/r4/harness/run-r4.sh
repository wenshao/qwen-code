#!/bin/bash
# Round 4 (b15a7496d4) on macOS, DB r4. Sequential.
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
run() { echo "=== $* $(date -u +%T)"; env DB=r4 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-380; }
run ARM=head6 node s11-cancel.mjs
run ARM=head6 node s14-activation-fault.mjs
run ARM=head6 node s15-history-hooks.mjs
run ARM=head6 WS=ws-hvs HOOK=hv-start node s9mac-refusal.mjs
run ARM=head6 WS=ws-hvo HOOK=hvo-ups node s9mac-refusal.mjs
run ARM=head6 WS=ws-hvp HOOK=hv-pre TOOL=1 node s9mac-refusal.mjs
run ARM=head6 node s12-lifecycle.mjs
run ARM=head6 node s2b-lease.mjs ws-t9d t yes SIGTERM
run ARM=head6 node s2e-reattach.mjs ws-t6b h
run ARM=head6 node s5b-lost.mjs ws-t4b ws-t9c
run ARM=head6 node s1-permission.mjs
run ARM=head6 node s3-catalog.mjs
run ARM=head6 node s4-prompt.mjs
run ARM=head6 node s6-limits.mjs
run ARM=head6 node s8-secrets.mjs
run ARM=head6 node s10-baseline.mjs
echo "=== ALL-DONE $(date -u +%T)"
