#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 2): MariaDB 10.11.18 with --default-time-zone=+08:00, JVM/Node TZ=Asia/Shanghai.
export DBHOST=pr13673-mdb RIGTZ=Asia/Shanghai
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; echo "#### $D jar=$A dist=$DI fault=$F db=$DBHOST tz=$RIGTZ $(date -u +%T)"; clean || return 1; up $D $A $DI
  if [ "$F" = unknown ]; then X "cd $R/probe && DB=$D ARM=$A $N p-unknown.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)|Error" | cut -c1-700
  else probe $D $A $DI FAULT=$F; fi; down $D; }
one hz-term head base spring-term
one hz-sw head base spring-workers
one hz-all head base all
one hz-unk head base unknown
one bz-sw base base spring-workers
echo BATCH3-DONE $(date -u +%T)
