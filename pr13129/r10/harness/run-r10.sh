#!/bin/bash
# Round 10 (d4dd9afbe3) on macOS, DB r10. Sequential.
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
run() { echo "=== $* $(date -u +%T)"; env DB=r10 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-380; }
run ARM=head12 node s20-bounded-refusal.mjs
run ARM=head12 node s11-cancel.mjs
run ARM=head12 node s14-activation-fault.mjs
run ARM=head12 node s15-history-hooks.mjs
run ARM=head12 WS=ws-hvs HOOK=hv-start node s9mac-refusal.mjs
run ARM=head12 WS=ws-hvo HOOK=hvo-ups node s9mac-refusal.mjs
run ARM=head12 WS=ws-hvp HOOK=hv-pre TOOL=1 node s9mac-refusal.mjs
run ARM=head12 node s12-lifecycle.mjs
run ARM=head12 node s2b-lease.mjs ws-t9d t yes SIGTERM
run ARM=head12 node s2e-reattach.mjs ws-t6b h
run ARM=head12 node s5b-lost.mjs ws-t4b ws-t9c
run ARM=head12 node s1-permission.mjs
run ARM=head12 node s3-catalog.mjs
run ARM=head12 node s4-prompt.mjs
run ARM=head12 node s6-limits.mjs
run ARM=head12 node s8-secrets.mjs
run ARM=head12 node s10-baseline.mjs
run ARM=head12 node s16-http-timeout.mjs
run SET=8 ARM=head12 node s17-cancel-window.mjs
run SET=a ARM=head12 node s18-refusal-recovery.mjs
echo "=== ALL-DONE $(date -u +%T)"
