#!/bin/bash
# batch-maria.sh <tree> <run-dir> <old-cli>  -- key scenarios on MariaDB (head)
TREE=$1; R=$2; OLD=$3; ARM=head-mariadb
S=$(cd "$(dirname "$0")/.." && pwd)
run() { local scen=$1 name=$2; shift 2; env "$@" ARM=$ARM bash $S/rig/run.sh $TREE $R $scen $name > /dev/null 2>&1; }
( run r1-release.ts r1-undelivered-1 R1_WS=0 R1_SERVERS=remote R1_FAULT=undelivered
  run r1-release.ts r1-lostack-1 R1_WS=2 R1_SERVERS=remote R1_FAULT=lostack
  run r3-upgrade.ts r3-lostack R3_WS=4 R3_MODE=lostack R3_OLD_CLI=$OLD ) &
( run r1-release.ts r1-undelivered-2 R1_WS=1 R1_SERVERS=remote,legacy R1_FAULT=undelivered
  run r4-never-dispatched.ts r4b-503 R4_WS=5 R4_FAULT=503 ) &
( run r2-sticky.ts r2-sticky-remote R2_WS=3 R2_SERVERS=sticky,remote ) &
wait
echo MARIA_ALL_DONE >> $R/batch.txt
