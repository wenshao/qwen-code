#!/bin/bash
# batch-r2.sh <tree> <run-dir> <arm>  -- sticky-stdout scenarios, one at a time (timing-sensitive)
TREE=$1; R=$2; ARM=$3
S=$(cd "$(dirname "$0")/.." && pwd)
run() { local name=$1; shift; env "$@" ARM=$ARM bash $S/rig/run.sh $TREE $R r2-sticky.ts $name > /dev/null 2>&1; }
run r2-sticky-1        R2_WS=10 R2_SERVERS=sticky
run r2-sticky-remote   R2_WS=11 R2_SERVERS=sticky,remote
run r2-remote-sticky   R2_WS=12 R2_SERVERS=remote,sticky
[ "${R2_WITH_RELOAD:-0}" = 1 ] && run r2-sticky-remote-reload R2_WS=13 R2_SERVERS=sticky,remote R2_RELOAD=1
echo R2_ALL_DONE >> $R/batch-r2.txt
