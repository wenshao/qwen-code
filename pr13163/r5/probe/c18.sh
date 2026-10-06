#!/bin/bash
# VERIFICATION RIG ONLY: store-drift case.  usage: c18.sh <db> <jar> <dist> <ws> <st>
R=/Users/wenshao/pr13163-rig; DB=$1; JAR=$2; D=$3; WS=$4; ST=$5
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
cd $R/probe; DB=$DB $N c18-store-drift.mjs start $WS $ST
bash $R/stop.sh $DB spring; STORE_URL=http://localhost:18163 DIST=$D bash $R/spring.sh $JAR $DB absent absent | tail -1
DB=$DB $N c18-store-drift.mjs cancel $WS $ST
