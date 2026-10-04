#!/bin/bash
# usage: cand-it.sh <worktree> <m2> <tag> <reps>
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH; export TZ=UTC
cd $1/packages/sdk-java/runtime-broker
for i in $(seq 1 $4); do
mvn -o -B -Dmaven.repo.local=$2 -Pmysql-integration -Duser.timezone=UTC \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33214/it_order_$3?allowPublicKeyRetrieval=true&useSSL=false&createDatabaseIfNotExist=true" \
  -Dmysql.user=root -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dit.test=JdbcRuntimeBrokerMySqlIT#releaseTransitionSeesAnAdmissionThatCommittedWhileItWaited" \
  test-compile failsafe:integration-test failsafe:verify > /Users/wenshao/pr13214-rig/logs/order-$3-$i.log 2>&1
echo "$3 run $i exit=$? $(grep -E 'Tests run: [0-9]+, F' /Users/wenshao/pr13214-rig/logs/order-$3-$i.log | tail -1)" >> /Users/wenshao/pr13214-rig/logs/order.status
done
