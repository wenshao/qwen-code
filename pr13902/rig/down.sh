#!/bin/bash
# usage: down.sh <run-dir>   (kills daemon and fake by recorded PID, waits for exit)
R=${1:?run dir}
for f in daemon fake; do
  if [ -f "$R/$f.pid" ]; then P=$(cat "$R/$f.pid"); kill "$P" 2>/dev/null && echo "killed $f $P"
    for i in $(seq 1 40); do kill -0 "$P" 2>/dev/null || break; sleep 0.25; done; fi
done
