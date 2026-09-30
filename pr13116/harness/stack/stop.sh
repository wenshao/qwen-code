#!/bin/bash
# VERIFICATION RIG ONLY: stop rig processes by recorded PID only.
S=/Users/wenshao/pr13116-rig/stack
for n in "$@"; do
  f=$S/run/$n.pid; [ -f $f ] || continue; p=$(cat $f)
  if [ "$n" = harness ]; then pkill -P $p 2>/dev/null; fi
  kill $p 2>/dev/null; for i in $(seq 1 80); do kill -0 $p 2>/dev/null || break; sleep 0.25; done
  kill -9 $p 2>/dev/null; rm -f $f; echo "stopped $n ($p)"
done
