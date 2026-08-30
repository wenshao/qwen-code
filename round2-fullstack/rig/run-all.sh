#!/bin/bash
set -u
RIG="$(cd "$(dirname "$0")" && pwd)"
SCENARIOS=(happy content-outage terminal-outage client-reconnect token-permanent token-transient)
for v in head base; do
  for s in "${SCENARIOS[@]}"; do
    echo "===== $v / $s ====="
    "$RIG/run-one.sh" "$v" "$s" m2 2>&1 | grep -E '^\[rig' | tail -12
  done
done
