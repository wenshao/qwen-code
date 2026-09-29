#!/bin/bash
# macOS host: the 'hosted-harness-mysql' job of sdk-java.yml, step by step, then its report guard.
# Runs in the worktree that has node_modules and dist for this head. usage: ci-hosted-job.sh <arm: head|renamed>
set -u
ARM=$1
RIG=/rig; WT=$RIG/wt-v3; O=$RIG/out/ci-$ARM; mkdir -p $O
export JAVA_HOME=/opt/jdk21
export PATH=/opt/node22/bin:$JAVA_HOME/bin:$PATH
export MAVEN_ARGS="-Dmaven.repo.local=$RIG/m2-native"
export GITHUB_WORKSPACE=$WT
cd $WT
T=packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/service
git checkout -q -- packages/sdk-java/managed-agent-server/pom.xml $T 2>/dev/null; rm -f $T/HostedWorkspaceRecoveryWorkerIT.java
if [ $ARM = renamed ]; then
  git mv -f $T/WorkspaceRecoveryWorkerIT.java $T/HostedWorkspaceRecoveryWorkerIT.java
  sed -i '' 's/class WorkspaceRecoveryWorkerIT/class HostedWorkspaceRecoveryWorkerIT/' $T/HostedWorkspaceRecoveryWorkerIT.java
  git show origin/main:packages/sdk-java/managed-agent-server/pom.xml > packages/sdk-java/managed-agent-server/pom.xml
fi
echo "[$ARM] tree: $(git rev-parse --short HEAD) $(git status --short | tr '\n' ' ')"
(mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install) > $O/hosted-1-install.log 2>&1; echo "[$ARM] step 'Install Managed Agent dependencies': exit=$?"
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="${GITHUB_WORKSPACE}/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:13869/hosted_harness_test_$ARM?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify checkstyle:check > $O/hosted-2-verify.log 2>&1; echo "[$ARM] step 'Verify Hosted Java, Spring and MySQL processes': exit=$?"
grep -E "Tests run:.*-- in .*IT$" $O/hosted-2-verify.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*-- in / -- /'
grep -E "^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures" $O/hosted-2-verify.log | sed 's/^\[[A-Z]*\] //' | tr '\n' '|'; echo
node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server > $O/hosted-3-guard.log 2>&1; echo "[$ARM] step 'Check that every Hosted integration test class ran': exit=$?"
cat $O/hosted-3-guard.log
git checkout -q -- packages/sdk-java/managed-agent-server/pom.xml 2>/dev/null
if [ $ARM = renamed ]; then git mv -f $T/HostedWorkspaceRecoveryWorkerIT.java $T/WorkspaceRecoveryWorkerIT.java; git checkout -q -- $T/WorkspaceRecoveryWorkerIT.java; fi
echo "[$ARM] tree restored: $(git status --short | tr '\n' ' ')"
echo "[$ARM] HOSTED-JOB-DONE"
