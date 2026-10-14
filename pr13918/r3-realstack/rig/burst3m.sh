#!/bin/bash
# MariaDB variant (jars with #14177 catalog fix, TS from the matching arm). usage: burst3m.sh <tag> <pool> <n> [arms]  — fresh stack per arm (arms run in parallel), one burst each
RIG=/Users/wenshao/pr13918-rig; cd $RIG
TAG=$1; POOLSZ=$2; N=$3; ARMLIST=${4:-r3j b3j}
one() {
  local arm=$1 db=${1:0:1}_${TAG}_p${POOLSZ}_n${N}
  rm -f state/serve-$db.json
  POOL=$POOLSZ JAR_ARM=$arm TS_ARM=${arm%j} nohup node rig3.mjs serve $arm $db > out/serve-$db.log 2>&1 &
  local spid=$!
  for i in $(seq 1 240); do [ -f state/serve-$db.json ] && break; kill -0 $spid 2>/dev/null || break; sleep 1; done
  [ -f state/serve-$db.json ] || { echo "[$db] STACK-FAILED"; kill -TERM $spid; return; }
  node drive3.mjs $db burst n=$N turnTimeout=150000 > out/drv-$db.log 2>&1
  echo "[$db] $(grep ' burst ' out/drv-$db.log | cut -c1-700 | tr '\n' ' ')"
  kill -TERM $spid; for i in $(seq 1 30); do kill -0 $spid 2>/dev/null || break; sleep 1; done
}
echo "=== $(date +%T) burst $TAG pool=$POOLSZ n=$N arms=$ARMLIST"
for a in $ARMLIST; do one $a & done
wait
echo "=== $(date +%T) BURST-DONE"
