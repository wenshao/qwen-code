#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 5, post-merge): the landed squash 7cbb993c (parent main 78a1d33a).
# Same fault matrix as the round-4 trial merge, plus the three lock injections from round 4, on the landed build.
source /Users/wenshao/pr13673-rig/rig.sh
one() { local D=$1 A=$2 DI=$3 F=$4; shift 4; echo "#### $D jar=$A dist=$DI fault=$F $* $(date -u +%T) load=$(uptime | sed 's/.*averages: //')"; clean || return 1; up $D $A $DI
  if [ "$F" = unknown ]; then X "cd $R/probe && DB=$D ARM=$A $N p-unknown.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)|Error" | cut -c1-700
  else probe $D $A $DI FAULT=$F "$@"; fi; down $D; }
until grep -q "^\[landed\] dist sha" $R/out/ts-r5.log; do sleep 15; done; echo "landed dist ready $(date -u +%T)"
one r5l-sw landed landed spring-workers DEADLINE_MS=300000
one r5l-term landed landed spring-term
one r5l-kill landed landed spring-kill
one r5l-all landed landed all
one r5l-unk landed landed unknown
one r5l-guard landed landed spring-workers LOCK=guard LOCK_MS=45000 DEADLINE_MS=300000
one r5l-holder landed landed spring-workers LOCK=holder LOCK_MS=45000 DEADLINE_MS=300000
one r5l-flock landed landed spring-workers FLOCK_MS=20000 DEADLINE_MS=300000
echo BATCH8-DONE $(date -u +%T)
