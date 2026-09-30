#!/bin/bash
# stop rig processes by recorded PID only. usage: stop.sh spring harness tap model oss
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/19f717cd-fa69-4495-b803-21c540ab1bd6/scratchpad/rig
for n in "$@"; do
  f=$R/run/$n.pid; [ -f $f ] || continue; p=$(cat $f)
  if [ "$n" = harness ] || [ "$n" = spring ]; then for c in $(pgrep -P $p); do kill $c 2>/dev/null; done; fi
  kill $p 2>/dev/null; for i in $(seq 1 60); do kill -0 $p 2>/dev/null || break; sleep 0.25; done
  kill -9 $p 2>/dev/null; rm -f $f; echo "stopped $n ($p)"
done
