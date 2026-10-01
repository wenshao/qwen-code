#!/bin/bash
# VERIFICATION RIG ONLY: stop a component by its recorded PID only.  usage: stop.sh <db> <spring|...> [signal]
. /rig/rig.env
DB=$1; WHAT=$2; SIG=${3:-TERM}; RUN=$RIG/run/$DB
f=$RUN/$WHAT.pid; [ -f $f ] || { echo "no pid file for $WHAT"; exit 0; }
p=$(cat $f)
if kill -0 $p 2>/dev/null; then kill -$SIG $p 2>/dev/null; for i in $(seq 1 80); do kill -0 $p 2>/dev/null || break; perl -e 'select(undef,undef,undef,0.25)'; done; kill -0 $p 2>/dev/null && kill -KILL $p 2>/dev/null; fi
rm -f $f; echo "stopped $WHAT pid=$p sig=$SIG"
