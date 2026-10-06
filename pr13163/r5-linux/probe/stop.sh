#!/bin/bash
# VERIFICATION RIG ONLY: stop components by recorded PID only.  usage: stop.sh <db> <spring|harness|model|tap|vite-head|vite-base|all> [signal]
. /root/v13163/rig/rig.env
DB=$1; WHAT=$2; SIG=${3:-TERM}; RUN=$RIG/run/$DB
stop1() { f=$RUN/$1.pid; [ -f $f ] || return 0; p=$(cat $f); if kill -0 $p 2>/dev/null; then
    [ "$1" = harness ] && for c in $(pgrep -P $p 2>/dev/null); do kill -$SIG $c 2>/dev/null; done
    kill -$SIG $p 2>/dev/null; for i in $(seq 1 40); do kill -0 $p 2>/dev/null || break; sleep 0.25; done; kill -0 $p 2>/dev/null && kill -KILL $p 2>/dev/null; fi; rm -f $f; echo "stopped $1 pid=$p sig=$SIG"; }
if [ "$WHAT" = all ]; then for w in spring spring-b harness model tap btap; do stop1 $w; done; else stop1 $WHAT; fi
