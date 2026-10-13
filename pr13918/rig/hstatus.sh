#!/bin/bash
# usage: hstatus.sh <db> <session...>  — Harness /session/:id/status (with protocol + boot headers)
S=/Users/wenshao/pr13918-rig/state/serve-$1.json; shift
HP=$(jq -r .harnessPort $S); HT=$(jq -r .harnessToken $S)
BOOT=$(curl -s -H "authorization: Bearer $HT" -H "X-Qwen-Harness-Protocol-Version: 1" http://127.0.0.1:$HP/capabilities | jq -r .hostedHarness.bootId)
for s in "$@"; do echo "$s: $(curl -s -H "authorization: Bearer $HT" -H "X-Qwen-Harness-Protocol-Version: 1" -H "X-Qwen-Harness-Boot-Id: $BOOT" http://127.0.0.1:$HP/session/$s/status | head -c 900)"; done
