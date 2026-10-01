#!/bin/bash
# Round 2: F3 scope — refusal before effect, then cancel; which events recover?
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd /Users/wenshao/pr13129-rig/probe
run() { echo "=== $* $(date -u +%T)"; env DB=r2 ARM=head4 "$@" 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-330; }
run WS=ws-t8 node s9mac-refusal.mjs
run WS=ws-hv node s9mac-refusal.mjs
run WS=ws-hvs HOOK=hv-start node s9mac-refusal.mjs
run WS=ws-hvp HOOK=hv-pre TOOL=1 node s9mac-refusal.mjs
run WS=ws-t8p HOOK=cmd-pre TOOL=1 node s9mac-refusal.mjs
echo "=== ALL-DONE $(date -u +%T)"
