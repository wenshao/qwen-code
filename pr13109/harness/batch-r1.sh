#!/bin/bash
# batch-r1.sh <tree> <run-dir> <arm>   -- release-fault scenarios, three lanes
TREE=$1; R=$2; ARM=$3
S=$(cd "$(dirname "$0")/.." && pwd)
run() { local name=$1; shift; env "$@" ARM=$ARM bash $S/rig/run.sh $TREE $R r1-release.ts $name > /dev/null 2>&1; }
( run r1-undelivered-1 R1_WS=0 R1_SERVERS=remote R1_FAULT=undelivered
  run r1-lostreply-1   R1_WS=3 R1_SERVERS=remote R1_FAULT=lostreply
  run r1-none-3        R1_WS=6 R1_SERVERS=remote,legacy,local R1_FAULT=none
  echo A_DONE >> $R/batch-r1.txt ) &
( run r1-undelivered-2 R1_WS=1 R1_SERVERS=remote,legacy R1_FAULT=undelivered
  run r1-lostack-1     R1_WS=4 R1_SERVERS=remote R1_FAULT=lostack
  run r1-acq503        R1_WS=7 R1_SERVERS=remote R1_FAULT=undelivered R1_ACQUIRE=503
  echo B_DONE >> $R/batch-r1.txt ) &
( run r1-undelivered-stdio R1_WS=2 R1_SERVERS=local R1_FAULT=undelivered
  run r1-lostack-2     R1_WS=5 R1_SERVERS=remote,legacy R1_FAULT=lostack
  run r1-acq409other   R1_WS=8 R1_SERVERS=remote R1_FAULT=undelivered R1_ACQUIRE=409other
  run r1-acqreset      R1_WS=9 R1_SERVERS=remote R1_FAULT=undelivered R1_ACQUIRE=reset
  echo C_DONE >> $R/batch-r1.txt ) &
wait
echo R1_ALL_DONE >> $R/batch-r1.txt
