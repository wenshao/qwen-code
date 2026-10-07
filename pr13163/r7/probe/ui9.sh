#!/bin/bash
# VERIFICATION RIG ONLY: UI warm-failure scenario (c17) for one arm.  usage: ui9.sh <db> <jar> <dist> <arm> <ws> <st> <lang>
R=/Users/wenshao/pr13163-rig; DB=$1; JAR=$2; D=$3; ARM=$4; WS=$5; ST=$6; LANG=$7
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
cd $R/probe
DB=$DB $N w1-warm.mjs start $WS $ST revoke-drain
sleep 3; bash $R/stop.sh $DB spring; DIST=$D bash $R/spring.sh $JAR $DB absent absent | tail -1
DB=$DB $N c17-ui-warm.mjs $WS $ST $ARM $LANG
