#!/bin/bash
# build-java.sh  -- clone m2, build head (sdk, broker, server) then base (server only; broker source is identical)
set -e
S=/rig-host
R=/rig-host-12946
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
test -e $S/m2 || cp -Rc $R/m2 $S/m2
M="mvn -q -B -Dgpg.skip -Dmaven.repo.local=$S/m2"
cd $S/wt-head/packages/sdk-java/qwencode && $M -DskipTests install
cd $S/wt-head/packages/sdk-java/runtime-broker && $M -DskipTests clean install
cd $S/wt-head/packages/sdk-java/managed-agent-server && $M -DskipTests clean package
cd $S/wt-head/packages/sdk-java/managed-agent-server && $M dependency:build-classpath -Dmdep.includeScope=test -Dmdep.outputFile=$S/cp.txt
cd $S/wt-base/packages/sdk-java/managed-agent-server && $M -DskipTests clean package
ls -la $S/wt-head/packages/sdk-java/managed-agent-server/target/*.jar $S/wt-base/packages/sdk-java/managed-agent-server/target/*.jar
echo JAVA_BUILD_OK
