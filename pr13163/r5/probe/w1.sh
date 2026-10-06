#!/bin/bash
# VERIFICATION RIG ONLY: w1 warm-failure driver.  usage: w1.sh <db> <jar> <dist> <ws> <st> <mode> [restart|norestart]
R=/Users/wenshao/pr13163-rig; DB=$1; JAR=$2; D=$3; WS=$4; ST=$5; MODE=$6; RS=${7:-restart}
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
cd $R/probe
DB=$DB $N w1-warm.mjs start $WS $ST $MODE
if [ "$RS" = restart ]; then bash $R/stop.sh $DB spring; DIST=$D bash $R/spring.sh $JAR $DB absent absent | tail -1; fi
DB=$DB $N w1-warm.mjs observe $WS $ST $MODE
DB=$DB $N w1-warm.mjs cancel $WS $ST $MODE
