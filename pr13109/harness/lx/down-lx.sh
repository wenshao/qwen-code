#!/bin/bash
# down-lx.sh <run-dir>  -- stop Spring, MCP servers and this rig's workers (container-local)
RUN=$1
for f in "$RUN"/spring.pid "$RUN"/srv-*.pid; do [ -f "$f" ] && kill -9 "$(cat "$f")" 2>/dev/null; done
pkill -9 -f managed-runtime-worker 2>/dev/null
pkill -9 -f "cli.js serve" 2>/dev/null
sleep 1; ps -eo pid,args | grep -c "[j]ava\|[m]anaged-runtime-worker" || true
