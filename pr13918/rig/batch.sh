#!/bin/bash
# usage: batch.sh <tag> "<kind>:<hold> ..."   — one fresh head + base stack pair per case, run in parallel
RIG=/Users/wenshao/pr13918-rig; cd $RIG
TAG=$1; shift
run_arm() { # arm db kind hold
  local arm=$1 db=$2 kind=$3 hold=$4
  rm -f state/serve-$db.json
  JAR_ARM=$arm TS_ARM=$arm nohup node rig.mjs serve $arm $db > out/serve-$db.log 2>&1 &
  local spid=$!
  for i in $(seq 1 240); do [ -f state/serve-$db.json ] && break; kill -0 $spid 2>/dev/null || break; sleep 1; done
  if [ ! -f state/serve-$db.json ]; then echo "[$db] STACK-FAILED"; kill -TERM $spid 2>/dev/null; return; fi
  node drive.mjs $db inflight kind=$kind hold=$hold afterTimeout=60000 settleTimeout=120000 > out/drv-$db.log 2>&1
  echo "[$db] drive exit=$?"
  kill -TERM $spid; for i in $(seq 1 30); do kill -0 $spid 2>/dev/null || break; sleep 1; done
}
for c in "$@"; do
  kind=${c%%:*}; hold=${c##*:}
  echo "=== $(date +%T) case $kind $hold"
  for arm in ${ARMS:-head base}; do run_arm $arm ${arm:0:1}_${TAG}_${kind}_${hold} $kind $hold & done
  wait
done
echo "=== $(date +%T) BATCH-DONE"
