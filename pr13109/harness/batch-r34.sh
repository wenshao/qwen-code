#!/bin/bash
# batch-r34.sh <tree> <run-dir> <arm> <old-cli>  -- old-writer upgrade + never-dispatched scenarios (head rig)
TREE=$1; R=$2; ARM=$3; OLD=$4
S=$(cd "$(dirname "$0")/.." && pwd)
run() { local scen=$1 name=$2; shift 2; env "$@" ARM=$ARM bash $S/rig/run.sh $TREE $R $scen $name > /dev/null 2>&1; }
( run r3-upgrade.ts r3-lostack       R3_WS=15 R3_MODE=lostack R3_OLD_CLI=$OLD
  run r4-never-dispatched.ts r4-503  R4_WS=18 R4_FAULT=503 ) &
( run r3-upgrade.ts r3-undelivered1  R3_WS=16 R3_MODE=undelivered1 R3_OLD_CLI=$OLD
  run r4-never-dispatched.ts r4-drop R4_WS=19 R4_FAULT=drop-response ) &
( run r3-upgrade.ts r3-fenced        R3_WS=17 R3_MODE=fenced R3_OLD_CLI=$OLD
  run r4-never-dispatched.ts r4-none R4_WS=20 R4_FAULT=none ) &
wait
echo R34_ALL_DONE >> $R/batch-r34.txt
