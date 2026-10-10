#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 2): trial merge ba6b1ddb (head into main 1f4484d3) on MySQL 8.4 UTC, plus main2 control.
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; echo "#### $D jar=$A dist=$DI fault=$F $(date -u +%T)"; clean || return 1; up $D $A $DI
  if [ "$F" = unknown ]; then X "cd $R/probe && DB=$D ARM=$A $N p-unknown.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)|Error" | cut -c1-700
  else probe $D $A $DI FAULT=$F; fi; down $D; }
one m2-term merge2 main2 spring-term
one m2-kill merge2 main2 spring-kill
one m2-sw merge2 main2 spring-workers
one m2-all merge2 main2 all
one m2-unk merge2 main2 unknown
one n2-sw main2 main2 spring-workers
echo BATCH4-DONE $(date -u +%T)
