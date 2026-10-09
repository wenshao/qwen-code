#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): fault matrix (no reboot).  arms: head/base jars use dist base; merge/main jars use dist main.
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; echo "#### $D jar=$A dist=$DI fault=$F $(date -u +%T)"; clean || return 1; up $D $A $DI
  if [ "$F" = unknown ]; then X "cd $R/probe && DB=$D ARM=$A $N p-unknown.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)|Error" | cut -c1-700
  else probe $D $A $DI FAULT=$F; fi; down $D; }
one b-term base base spring-term
one h-kill head base spring-kill
one h-sw head base spring-workers
one b-sw base base spring-workers
one h-all head base all
one b-all base base all
one h-unk head base unknown
one m-term merge main spring-term
one m-sw merge main spring-workers
one m-all merge main all
one n-term main main spring-term
one m-unk merge main unknown
echo BATCH1-DONE $(date -u +%T)
