#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): fill-in arms.
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; echo "#### $D jar=$A dist=$DI fault=$F $(date -u +%T)"; clean || return 1; up $D $A $DI
  if [ "$F" = unknown ]; then X "cd $R/probe && DB=$D ARM=$A $N p-unknown.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)|Error" | cut -c1-700
  else probe $D $A $DI FAULT=$F; fi; down $D; }
one m-kill merge main spring-kill
one b-kill base base spring-kill
one b-unk base base unknown
echo BATCH2-DONE $(date -u +%T)
