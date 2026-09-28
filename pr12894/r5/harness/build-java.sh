#!/bin/bash
set -e
W=${1:-$HOME/git/qwen-code-pr12894}
M=$(dirname $0)/mvn.sh
cd $W
$M -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q
$M -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q
$M -f packages/sdk-java/managed-agent-server/pom.xml -DskipTests package -q
ls -la packages/sdk-java/managed-agent-server/target/*.jar
