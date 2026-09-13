#!/bin/bash
source /root/git/h11644/env.sh
[ -f "$H/daemon.pid" ] && kill "$(cat $H/daemon.pid)" 2>/dev/null || true
sleep 1
pkill -f "dist/cli.js serve --port $PORT" 2>/dev/null || true
echo "daemon stopped"
