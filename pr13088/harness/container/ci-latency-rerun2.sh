#!/bin/bash
# container: the one Hosted test that needs `git rev-parse HEAD` in the checkout (the first replay had no git metadata mounted).
set -u; TREE=${1:-wt-merge}; TAG=${2:-new}
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
git config --global --add safe.directory '*'
cp -a /root/.m2/repository /m2; export MAVEN_ARGS="-Dmaven.repo.local=/m2"
cd /rig/${TREE}; echo "git rev-parse HEAD in the tree: $(git rev-parse HEAD 2>&1 | cut -c1-60)"
(mvn --batch-mode --no-transfer-progress -q -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && mvn --batch-mode --no-transfer-progress -q -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install) > /dev/null 2>&1; echo "sibling modules installed from this tree: exit=$?"
GUARD=$([ -f packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store/WorkspaceStorageGuardTest.java ] && echo WorkspaceStorageGuardTest || echo WorkspaceRuntimeTest)
DBN=hosted_harness_latency_$(date +%s)
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql "-Dnode.executable=$(command -v node)" "-Dqwen.cli.entry=/rig/${TREE}/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw -Dcheckstyle.skip=true -Dtest=$GUARD '-Dit.test=HostedWorkspaceToolTurnIT#recordsLatencyWithDelayedRuntimeProvisioning' verify > /rig/out/ci-new/h1b-latency-${TAG}.log 2>&1; echo "exit=$?"
grep -E "Tests run:.*-- in .*IT$|HOSTED_LATENCY_OK|<<< (FAILURE|ERROR)" /rig/out/ci-new/h1b-latency-${TAG}.log | cut -c1-200
test -s packages/sdk-java/managed-agent-server/target/hosted-latency-baseline.json && echo "hosted-latency-baseline.json written ($(wc -c < packages/sdk-java/managed-agent-server/target/hosted-latency-baseline.json) bytes)"
