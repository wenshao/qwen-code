#!/bin/bash
# usage: run-one.sh <head|cand3> <reps>  -> ToolPublicationAsyncVerificationMySqlIT#acceptanceWaitsForTheReadyTransactionToCommit, N separate runs
P=$(cd $(dirname $0); pwd); R=$P/../../rig; W=$HOME/git/qwen-code-pr13654-probe; ARM=$1; N=${2:-3}
F=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java
D=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationDataStore.java
cd $W || exit 1; git checkout -q -- $F $D
[ "$ARM" = cand3 ] && { git apply $P/candidate-settled-accepted-work.diff || exit 1; }
for i in $(seq 1 $N); do
  $R/mvn-r2.sh -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
    -Dit.test='ToolPublicationAsyncVerificationMySqlIT#acceptanceWaitsForTheReadyTransactionToCommit' -Dfailsafe.failIfNoSpecifiedTests=false \
    "-Dmysql.url=jdbc:mysql://127.0.0.1:13654/p654probe4?allowPublicKeyRetrieval=true&useSSL=false&createDatabaseIfNotExist=true" -Dmysql.user=root -Dmysql.password=rig13654 \
    -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true verify > $P/mvn-one-$ARM-$i.log 2>&1
  echo "$ARM run $i load $(uptime | sed 's/.*averages: //'): $(grep -h -o 'Tests run: [0-9]*, Failures: [0-9]*, Errors: [0-9]*' $P/mvn-one-$ARM-$i.log | tail -1)"
done
git checkout -q -- $F $D; git diff --quiet -- $F $D && echo "restored"
