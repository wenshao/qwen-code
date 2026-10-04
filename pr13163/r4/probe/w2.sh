#!/bin/bash
R=/Users/wenshao/pr13163-rig; DB=$1; JAR=$2; D=$3; WS=$4
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
cd $R/probe; DB=$DB $N w2-latch.mjs start $WS h
bash $R/stop.sh $DB spring; DIST=$D bash $R/spring.sh $JAR $DB absent absent | tail -1
DB=$DB $N w2-latch.mjs observe $WS h
DB=$DB $N w2-latch.mjs cancel $WS h
echo "--- harness latch lines:"; /usr/bin/grep -h 'session log writes stopped\|Managed Session Store request failed' $(ls -t $R/run/$DB/harness-*.log | head -1) | cut -c1-260 | tail -4
