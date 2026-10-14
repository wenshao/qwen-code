#!/bin/bash
cd /Users/wenshao/pr13918-rig
for i in 1 2 3; do bash itm.sh r3m r3m r3m-async$i ToolPublicationAsyncVerificationMySqlIT; bash itm.sh b3j b3j b3j-async$i ToolPublicationAsyncVerificationMySqlIT; done
bash itm.sh r3m r3m r3m-hook "ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql"
bash itm.sh b3j b3j b3j-hook "ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql"
# broker ITs (database now exists)
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
L=out/itm-r3m-broker.log
(cd src-r3m/packages/sdk-java/runtime-broker && /Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=/Users/wenshao/pr13918-rig/m2-r3m -Pmysql-integration -Dcheckstyle.skip=true -Dspotbugs.skip=true test-compile failsafe:integration-test failsafe:verify \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23920/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker) > $L 2>&1
echo "[r3m-broker] EXIT=$? $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L | tail -1) $(grep -E '<<< (FAILURE|ERROR)!$' $L | sed 's/ -- Time.*//' | tr '\n' ' ')"
echo MARIADB-FOLLOWUP-DONE
