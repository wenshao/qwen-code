#!/bin/bash
set -e
S=/rig-host
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
test -e $S/m2-merge || cp -Rc $S/m2 $S/m2-merge
M="mvn -q -B -Dgpg.skip -Dmaven.repo.local=$S/m2-merge"
cd $S/wt-merge/packages/sdk-java/qwencode && $M -DskipTests install
cd $S/wt-merge/packages/sdk-java/runtime-broker && $M -DskipTests clean install
cd $S/wt-merge/packages/sdk-java/managed-agent-server && $M -DskipTests clean package
sed "s#$S/m2/#$S/m2-merge/#g" $S/cp.txt > $S/cp-merge.txt
echo JAVA_MERGE_OK
