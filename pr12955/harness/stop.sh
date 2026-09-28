#!/bin/bash
# stop rig processes by recorded PID only
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad/rig
for n in "$@"; do
  f=$R/run/$n.pid; [ -f $f ] || continue; p=$(cat $f)
  if [ "$n" = harness ]; then pkill -P $p 2>/dev/null; fi
  kill $p 2>/dev/null; for i in $(seq 1 40); do kill -0 $p 2>/dev/null || break; sleep 0.25; done
  kill -9 $p 2>/dev/null; rm -f $f; echo "stopped $n ($p)"
done
