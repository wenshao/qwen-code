#!/bin/bash
# CI step "Install Managed Agent dependencies"
source "$(dirname "$0")/env.sh"
WT=$1
cd "$WT" || exit 2
"${MVN[@]}" -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install &&
"${MVN[@]}" -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install
