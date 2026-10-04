#!/bin/bash
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
R=/Users/wenshao/pr13214-rig; W=/Users/wenshao/git/pr13214-merge/packages/sdk-java; L=$R/logs/merge-build.log; : > $L
cd $W/qwencode && mvn -B -Dmaven.repo.local=$R/m2-merge -Dgpg.skip=true -DskipTests -Dspotbugs.skip=true -Dcheckstyle.skip=true clean install >> $L 2>&1; e0=$?
cd $W/runtime-broker && mvn -o -B -Dmaven.repo.local=$R/m2-merge -DskipTests -Dspotbugs.skip=true -Dcheckstyle.skip=true clean install >> $L 2>&1; e1=$?
cd $W/managed-agent-server && mvn -B -Dmaven.repo.local=$R/m2-merge -Dspotbugs.skip=true -Dcheckstyle.skip=true -Dtest='EmbeddedRuntimeBrokerTest,ManagedAgentPropertiesTest' -Dsurefire.failIfNoSpecifiedTests=false clean package >> $L 2>&1; e2=$?
echo "qwencode=$e0 broker=$e1 server=$e2" > $R/logs/merge-build.status
