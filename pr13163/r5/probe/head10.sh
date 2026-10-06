#!/bin/bash
# VERIFICATION RIG ONLY: round-5 head arm.  usage: head10.sh <db> <jar> <dist> <tag>
R=/Users/wenshao/pr13163-rig; DB=$1; JAR=$2; D=$3; TAG=$4
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
L=$R/out/$DB/arm-$TAG.log; mkdir -p $(dirname $L); : > $L
fresh() { bash $R/stop.sh $DB all >> $L 2>&1; sleep 1; bash $R/start9.sh $DB $JAR $D 2>&1 | tail -1 >> $L; }
restart() { bash $R/stop.sh $DB spring >> $L 2>&1; DIST=$D bash $R/spring.sh $JAR $DB absent absent 2>&1 | tail -1 >> $L; }
cd $R/probe
fresh
[ "${QUICK:-}" = 1 ] && bash $R/batch-n4.sh $DB $TAG quick || bash $R/batch-n4.sh $DB $TAG
for x in "c16-page-caps.mjs ws-p1 a ws-p0 b regen" "c16-page-caps.mjs ws-p2 c ws-p0 b storage" "f4b-sql-state.mjs ws-f4b e" "c19-rename-race.mjs bound ws-c19 f" "c19-rename-race.mjs unbound - -"; do
  echo "### $x" >> $L; DB=$DB $N $x >> $L 2>&1
done
for m in revoke none; do
  echo "### c14 $m" >> $L; DB=$DB $N c14-cold-cache.mjs start ws-k$m-$TAG a $m >> $L 2>&1; restart; DB=$DB $N c14-cold-cache.mjs cancel ws-k$m-$TAG a $m >> $L 2>&1
done
fresh
echo "### c18 store drift" >> $L; bash $R/c18.sh $DB $JAR $D ws-drift-$TAG g >> $L 2>&1
fresh
echo "### c10 wedge" >> $L; DB=$DB $N c10-blocked.mjs ws-c10-$TAG h revoked >> $L 2>&1
bash $R/stop.sh $DB all >> $L 2>&1
echo "ARM-DONE $(date -u +%T)" >> $L
