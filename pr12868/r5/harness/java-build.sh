#!/bin/bash
SCRATCH=/rig-home
WT=$1; TAG=$2
cd $WT || exit 1
$SCRATCH/bin/mvnw.sh -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SCRATCH/logs/mvn-sdk-$TAG.log 2>&1; echo "sdk rc=$?"
$SCRATCH/bin/mvnw.sh -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SCRATCH/logs/mvn-broker-install-$TAG.log 2>&1; echo "broker rc=$?"
$SCRATCH/bin/mvnw.sh -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests clean package > $SCRATCH/logs/mvn-server-package-$TAG.log 2>&1; echo "server rc=$?"
ls -la packages/sdk-java/managed-agent-server/target/*.jar packages/sdk-java/runtime-broker/target/*.jar
