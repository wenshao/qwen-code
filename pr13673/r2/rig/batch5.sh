#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 2): re-run base on MariaDB +08:00 (first attempt invalid: setup Turns stalled under host load).
export DBHOST=pr13673-mdb RIGTZ=Asia/Shanghai
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; echo "#### $D jar=$A dist=$DI fault=$F db=$DBHOST tz=$RIGTZ $(date -u +%T)"; clean || return 1; up $D $A $DI; probe $D $A $DI FAULT=$F; down $D; }
one bz2-sw base base spring-workers
echo BATCH5-DONE $(date -u +%T)
