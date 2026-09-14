#!/bin/bash
export ARM="${1:-head}"
source "$(dirname "$0")/env.sh"
killport() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | sort -u | xargs -r kill 2>/dev/null; }
killport "$PORT"
[ "${2:-}" = "--mock" ] && killport "$MOCK_PORT"
sleep 1
pgrep -af "$WT/dist/cli.js" | grep -v pgrep || true
echo "stopped arm=$ARM"
