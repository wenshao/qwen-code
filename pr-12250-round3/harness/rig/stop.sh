#!/bin/bash
export ARM="${1:-head}"
source "$(dirname "$0")/env.sh"
for f in daemon mock; do
  pf="$R/out/$f-$ARM.pid"
  if [ -f "$pf" ]; then
    pid=$(cat "$pf"); pkill -TERM -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; rm -f "$pf"; echo "stopped $f $pid"
  fi
done
