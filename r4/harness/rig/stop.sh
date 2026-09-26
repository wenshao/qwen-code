#!/bin/bash
# stop by PID only (never by command-line pattern: other sessions share this machine)
export ARM="${1:-obs}"
source "$(dirname "$0")/env.sh"
kill_tree() { local p=$1; for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done; kill "$p" 2>/dev/null; }
pf="$R/out/daemon-$ARM.pid"
if [ -f "$pf" ]; then pid=$(cat "$pf"); kill_tree "$pid"; rm -f "$pf"; echo "stopped daemon $pid"; fi
if [ "${2:-}" = mock ] && [ -f "$R/out/mock.pid" ]; then kill "$(cat $R/out/mock.pid)" 2>/dev/null; rm -f "$R/out/mock.pid"; echo "stopped mock"; fi
