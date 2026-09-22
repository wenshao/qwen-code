#!/bin/bash
source /root/verify/pr12404-r2-e2e/env.sh
if [ -f "$H/daemon.pid" ]; then P=$(cat "$H/daemon.pid"); kill -- -"$P" 2>/dev/null || kill "$P" 2>/dev/null || true
  for i in $(seq 1 40); do kill -0 "$P" 2>/dev/null || break; sleep 0.25; done
  kill -9 -- -"$P" 2>/dev/null || true; rm -f "$H/daemon.pid"; fi
echo "daemon stopped"
