#!/bin/bash
cd $SP/wt-trial-12839
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2-trial"
mvn $A -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/trial-qwencode.log 2>&1; mvn $A -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dgpg.skip=true install > $SP/logs/trial-broker.log 2>&1
mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -Dcheckstyle.skip -Dtest=ManagedSessionOperationMigrationTest,ManagedAgentApiContractTest -Dsurefire.failIfNoSpecifiedTests=false test > $SP/logs/trial-12839.log 2>&1; echo "rc=$?"
grep -E "Tests run:|FlywayException|more than one migration|Found more" $SP/logs/trial-12839.log | sort | uniq -c | head -8
