#!/bin/bash
# stop.sh <pr|base> [--mock]  -> kill the daemon (and optionally the mock) by port
export ARM="${1:-pr}"
source /root/git/h11636/env.sh
killport() {
  for pid in $(ss -lptnH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    kill "$pid" 2>/dev/null
  done
}
killport "$PORT"
[ "${2:-}" = "--mock" ] && killport "$MOCK_PORT"
sleep 1
# ACP children of the daemon exit with it; report leftovers for this worktree
pgrep -af "$WT/dist/cli.js" | grep -v pgrep || true
echo "stopped arm=$ARM"
