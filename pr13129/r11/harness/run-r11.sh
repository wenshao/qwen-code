#!/bin/bash
# Round 11 (4dbdd48736) on macOS, DB r11. Sequential.
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
run() { echo "=== $* $(date -u +%T)"; env PUNCT=1 DB=r11 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-380; }
run ARM=head13 node s20-bounded-refusal.mjs
run ARM=head13 node s11-cancel.mjs
run ARM=head13 node s14-activation-fault.mjs
run ARM=head13 node s15-history-hooks.mjs
run ARM=head13 WS=ws-hvs HOOK=hv-start node s9mac-refusal.mjs
run ARM=head13 WS=ws-hvo HOOK=hvo-ups node s9mac-refusal.mjs
run ARM=head13 WS=ws-hvp HOOK=hv-pre TOOL=1 node s9mac-refusal.mjs
run ARM=head13 node s12-lifecycle.mjs
run ARM=head13 node s2b-lease.mjs ws-t9d t yes SIGTERM
run ARM=head13 node s2e-reattach.mjs ws-t6b h
run ARM=head13 node s5b-lost.mjs ws-t4b ws-t9c
run ARM=head13 node s1-permission.mjs
run ARM=head13 node s3-catalog.mjs
run ARM=head13 node s4-prompt.mjs
run ARM=head13 node s6-limits.mjs
run ARM=head13 node s8-secrets.mjs
run ARM=head13 node s10-baseline.mjs
run ARM=head13 node s16-http-timeout.mjs
run SET=8 ARM=head13 node s17-cancel-window.mjs
run SET=a ARM=head13 node s18-refusal-recovery.mjs
run ARM=head13 node s23-owner-diagnostics.mjs
run ARM=head13 node s22-merge-policy.mjs
echo "=== ALL-DONE $(date -u +%T)"
