#!/bin/bash
# PR 6f5f7f6a merged into newest main e9b87acd (after #13335), conflict resolved by keeping both sides
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-r8b"
cd $S/wt-r8b; echo "commit $(git rev-parse --short HEAD) parents $(git log -1 --format=%p HEAD)"
$MVN -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $S/r8b-qwencode.log 2>&1; echo "qwencode exit=$?"
$MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true clean install > $S/r8b-broker.log 2>&1; echo "broker exit=$?"
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dspotbugs.skip=true \
  -Dtest='ManagedAgentPropertiesTest,RuntimeRetentionConfigurationTest,RuntimeBrokerFlywaySchemaTest,ManagedRuntimeRetention*Test,RuntimeRetentionJobTest,ToolPublicationStoreTest' \
  -Dsurefire.failIfNoSpecifiedTests=false clean test > $S/r8b-server.log 2>&1; echo "server targeted exit=$?"
grep -E 'Tests run: [0-9]+, F.*in |Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|ERROR\] (Failures|Errors|  [A-Za-z])|ERROR.*COMPILATION' $S/r8b-server.log | sed -E 's/, Time elapsed: [0-9.]+ s//;s/^\[(INFO|WARNING|ERROR)\] //' | tail -20
echo R8B-DONE
