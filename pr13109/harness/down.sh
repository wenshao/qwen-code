#!/bin/bash
# down.sh <run-dir>  -- stop this rig only, by recorded PID
RUN=$1
for f in "$RUN"/spring.pid "$RUN"/srv-*.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null
done
