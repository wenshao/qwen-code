#!/bin/bash
# stop.sh — kill rig processes by recorded PID only (and their process groups' children)
R=/root/pr12279
for f in $R/run/*.pid; do
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null; echo "stopped $(basename $f .pid) $pid"
  fi
  rm -f "$f"
done
