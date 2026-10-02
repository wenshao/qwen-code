#!/bin/bash
# VERIFICATION RIG ONLY: stop container components by recorded PID only.  usage: stop.sh <db> <spring|harness|model|tap|all> [signal]
. /Users/wenshao/pr13112-rig/lx/env.sh
DB=$1; WHAT=$2; SIG=${3:-TERM}; RUN=$VAR/run/$DB
stop1() { f=$RUN/$1.pid; [ -f $f ] || return 0; p=$(cat $f); if kill -0 $p 2>/dev/null; then
    kill -$SIG $p 2>/dev/null; for i in $(seq 1 60); do kill -0 $p 2>/dev/null || break; sleep 0.25; done; kill -0 $p 2>/dev/null && kill -KILL $p 2>/dev/null; fi; rm -f $f; echo "stopped $1 pid=$p sig=$SIG"; }
if [ "$WHAT" = all ]; then for w in spring harness model tap; do stop1 $w; done; else stop1 $WHAT; fi
ps -eo pid=,ppid=,args= | awk -v d="$RIG/dist/" 'index($0, d) && $0 !~ / serve / {print "worker-left pid="$1" ppid="$2}'
