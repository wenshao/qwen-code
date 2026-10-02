#!/bin/bash
# stop rig processes for one db by recorded PID.  usage: stop.sh <db> [spring harness model tap]
. /Users/wenshao/pr13225-rig/lx/env.sh
DB=$1; shift; RUN=$VAR/run/$DB
for n in ${@:-harness spring tap model}; do
  f=$RUN/$n.pid; [ -f $f ] || continue; p=$(cat $f)
  kill $p 2>/dev/null; for i in $(seq 1 60); do kill -0 $p 2>/dev/null || break; sleep 0.25; done
  kill -9 $p 2>/dev/null; rm -f $f; echo "stopped $n ($p)"
done
