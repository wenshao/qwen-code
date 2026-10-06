#!/bin/bash
R=/Users/wenshao/pr13163-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
L=$R/out/c20.log; : > $L
for arm in "h10p n10 n10" "b10p b10 b10"; do
  set -- $arm; DB=$1; JAR=$2; D=$3
  bash $R/stop.sh $DB all >> $L 2>&1; bash $R/start9.sh $DB $JAR $D 2>&1 | tail -1 >> $L
  cd $R/probe
  echo "### [$DB] c10" >> $L; DB=$DB $N c10-blocked.mjs ws-pinA a revoked >> $L 2>&1
  echo "### [$DB] c20" >> $L; DB=$DB $N c20-storage-pin.mjs a b >> $L 2>&1
  bash $R/stop.sh $DB all >> $L 2>&1
done
echo "C20-DONE $(date -u +%T)" >> $L
