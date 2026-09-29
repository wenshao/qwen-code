#!/bin/bash
# macOS host: the 'hosted-harness-mysql' job of sdk-java.yml, step by step, then its report guard and the fault gates step.
# The worktree must already be installed, built and bundled. usage: ci-hosted-job2.sh <label> <worktree> <database>
set -u
LABEL=$1; WT=$2; DB=$3
RIG=/rig; O=$RIG/out/ci-$LABEL; mkdir -p $O
export JAVA_HOME=/opt/jdk21
export PATH=/opt/node22/bin:$JAVA_HOME/bin:$PATH
export MAVEN_ARGS="-Dmaven.repo.local=$RIG/m2-native"
export GITHUB_WORKSPACE=$WT
cd $WT
echo "[$LABEL] tree: $(git rev-parse --short HEAD) $(git status --short | tr '\n' ' ')"
(mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install) > $O/hosted-1-install.log 2>&1; echo "[$LABEL] step 'Install Managed Agent dependencies': exit=$?"
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="${GITHUB_WORKSPACE}/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:13869/$DB?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify checkstyle:check > $O/hosted-2-verify.log 2>&1; echo "[$LABEL] step 'Verify Hosted Java, Spring and MySQL processes': exit=$?"
grep -E "Tests run:.*-- in .*IT$" $O/hosted-2-verify.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed.*-- in / -- /'
grep -E "^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures" $O/hosted-2-verify.log | sed 's/^\[[A-Z]*\] //' | tr '\n' '|'; echo
node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server > $O/hosted-3-guard.log 2>&1; echo "[$LABEL] step 'Check that every Hosted integration test class ran': exit=$?"
cat $O/hosted-3-guard.log
echo "[$LABEL] tree afterwards: $(git status --short | tr '\n' ' ')"
echo "[$LABEL] HOSTED-JOB-DONE"
