#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 4): head 6d65c83b unchanged. Measures yiliang114's review items on the real stack
# (R2-1 lock wait under the renewal monitor, R2-2 per-path lock between the two reconciles, LOST states) plus a
# workers-only fault, then the trial merge 0aa2f8c9 (head into main fce50611).
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; shift 4; echo "#### $D jar=$A dist=$DI fault=$F $* $(date -u +%T) load=$(uptime | sed 's/.*averages: //')"; clean || return 1; up $D $A $DI
  if [ "$F" = unknown ]; then X "cd $R/probe && DB=$D ARM=$A $N p-unknown.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)|Error" | cut -c1-700
  else probe $D $A $DI FAULT=$F "$@"; fi; down $D; }
one r4h-sw head head spring-workers DEADLINE_MS=300000
one r4h-guard head head spring-workers LOCK=guard LOCK_MS=45000 DEADLINE_MS=300000
one r4h-holder head head spring-workers LOCK=holder LOCK_MS=45000 DEADLINE_MS=300000
one r4h-flock head head spring-workers FLOCK_MS=20000 DEADLINE_MS=300000
one r4h-workers head head workers RESTART_AFTER_MS=180000 DEADLINE_MS=420000
one r4b-workers base head workers RESTART_AFTER_MS=180000 DEADLINE_MS=420000
until grep -q "^\[merge3\] dist sha" $R/out/ts-r4.log; do sleep 15; done; echo "merge3 dist ready $(date -u +%T)"
one r4m-sw merge3 merge3 spring-workers
one r4m-term merge3 merge3 spring-term
one r4m-kill merge3 merge3 spring-kill
one r4m-all merge3 merge3 all
one r4m-unk merge3 merge3 unknown
echo BATCH7-DONE $(date -u +%T)
