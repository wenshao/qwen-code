#!/bin/bash
# VERIFICATION RIG ONLY: start model+tap, Harness and Spring for one arm.  usage: start9.sh <db> <jar> <dist>
R=/Users/wenshao/pr13163-rig; DB=$1; JAR=$2; D=$3
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
bash $R/aux.sh $DB
bash $R/harness.sh $DB $D
DIST=$D bash $R/spring.sh $JAR $DB absent absent
