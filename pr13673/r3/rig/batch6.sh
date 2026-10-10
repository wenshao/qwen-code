#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 3): head 6d65c83b (main fe2dd7f6 merged + schema fix), base fe2dd7f6 control,
# trial merge 87f37f91 (head into main df72e2d1), and an emulated child-Workspace maintenance hold on the target storage.
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; shift 4; echo "#### $D jar=$A dist=$DI fault=$F $* $(date -u +%T) load=$(uptime | sed 's/.*averages: //')"; clean || return 1; up $D $A $DI
  if [ "$F" = unknown ]; then X "cd $R/probe && DB=$D ARM=$A $N p-unknown.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)|Error" | cut -c1-700
  else probe $D $A $DI FAULT=$F "$@"; fi; down $D; }
one r3h-term head head spring-term
one r3h-sw head head spring-workers
one r3b-sw base head spring-workers  # base fe2dd7f6 has the same Node sources as head (PR changes Java + docs only)
one r3h-kill head head spring-kill
one r3h-all head head all
one r3h-unk head head unknown
one r3h-tmaint head head spring-term MAINT_HOLD_MS=90000 DEADLINE_MS=300000
one r3h-swmaint head head spring-workers MAINT_HOLD_MS=90000 DEADLINE_MS=300000
until grep -q "^\[merge2\] dist sha" $R/out/ts-r3.log; do sleep 15; done; echo "merge2 dist ready $(date -u +%T)"
one r3m-sw merge2 merge2 spring-workers
one r3m-term merge2 merge2 spring-term
one r3m-unk merge2 merge2 unknown
echo BATCH6-DONE $(date -u +%T)
