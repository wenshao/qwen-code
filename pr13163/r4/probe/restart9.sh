#!/bin/bash
# VERIFICATION RIG ONLY: cold-cache cancel (c14) and warm-failure (w1) cases for one arm.  usage: restart9.sh <db> <jar> <dist> <tag>
R=/Users/wenshao/pr13163-rig; DB=$1; JAR=$2; D=$3; TAG=$4
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
L=$R/out/$DB/restart-$TAG.log; mkdir -p $(dirname $L); : > $L
restart() { bash $R/stop.sh $DB spring >> $L 2>&1; DIST=$D bash $R/spring.sh $JAR $DB absent absent 2>&1 | tail -1 >> $L; }
cd $R/probe
for m in revoke none; do
  echo "### c14 $m" >> $L
  DB=$DB $N c14-cold-cache.mjs start ws-k$m-$TAG a $m >> $L 2>&1
  restart
  DB=$DB $N c14-cold-cache.mjs cancel ws-k$m-$TAG a $m >> $L 2>&1
done
for m in none revoke revoke-drain; do
  echo "### w1 $m restart" >> $L
  bash $R/w1.sh $DB $JAR $D ws-w$m-$TAG b $m restart >> $L 2>&1
done
echo "### w1 revoke-drain norestart" >> $L
bash $R/w1.sh $DB $JAR $D ws-wnr-$TAG c revoke-drain norestart >> $L 2>&1
echo "RESTART9-DONE $(date -u +%T)" >> $L
