#!/bin/bash
# VERIFICATION RIG ONLY: stop rig processes by recorded PID only.
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c7d2ab96-3862-4fe9-966f-d80da045ac10/scratchpad/rig
for n in "$@"; do
  if [ "$n" = spring-kill9 ]; then f=$R/run/spring.pid; p=$(cat $f); kill -9 $p 2>/dev/null; rm -f $f; echo "SIGKILL spring ($p)"; continue; fi
  f=$R/run/$n.pid; [ -f $f ] || continue; p=$(cat $f)
  if [ "$n" = harness ]; then pkill -P $p 2>/dev/null; fi
  kill $p 2>/dev/null; for i in $(seq 1 60); do kill -0 $p 2>/dev/null || break; sleep 0.25; done
  kill -9 $p 2>/dev/null; rm -f $f; echo "stopped $n ($p)"
done
