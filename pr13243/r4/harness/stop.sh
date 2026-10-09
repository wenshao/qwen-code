#!/bin/bash
# VERIFICATION RIG ONLY: stop Spring by recorded PID; then list worker processes of this rig (by dist path, node binary only).
. /Users/wenshao/pr13243-rig/rig.env
DB=$1; RUN=$RIG/run/$DB; f=$RUN/spring.pid
if [ -f $f ]; then p=$(cat $f); kill $p 2>/dev/null; for i in $(seq 1 60); do kill -0 $p 2>/dev/null || break; sleep 0.5; done; kill -0 $p 2>/dev/null && kill -9 $p; rm -f $f; echo "stopped spring pid=$p"; fi
ps -axo pid=,ppid=,command= | awk -v r="$RIG/dist/" '$3 ~ /\/node$/ && index($0, r) && $0 !~ / serve / {print "worker-left pid="$1" ppid="$2}'
