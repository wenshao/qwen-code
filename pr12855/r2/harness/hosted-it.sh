#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
A="--batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
cd $SP/wt-v4m
mvn $A -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/v4m-qwencode-2.log 2>&1 && mvn $A -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $SP/logs/v4m-broker-2.log 2>&1; echo "merge broker installed rc=$?"
for PROFILE in hosted-harness-mysql hosted-workspace-tools; do
  docker exec pr12855-mysql84 mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS hosted_harness_test; CREATE DATABASE hosted_harness_test" 2>/dev/null
  mvn $A -f packages/sdk-java/managed-agent-server/pom.xml -P$PROFILE -Dnode.executable=$NODE -Dqwen.cli.entry=$SP/wt-v4m/dist/cli.js "-Dmysql.url=jdbc:mysql://127.0.0.1:13856/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=hosted-fixture verify > $SP/logs/v4m-$PROFILE.log 2>&1
  echo "$PROFILE rc=$?"; grep -E "Tests run: [0-9]+, Fail|BUILD" $SP/logs/v4m-$PROFILE.log | grep -v " -- in " | tail -3
done
cd $SP/wt-v4m && PATH=~/Install/mysql-8.4.7-macos15-arm64/bin:$PATH npx tsx scripts/run-managed-agent-server-e2e.ts --session-failover > $SP/logs/v4m-hosted-e2e.log 2>&1; echo "hosted e2e rc=$?"
