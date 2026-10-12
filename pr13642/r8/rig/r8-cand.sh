#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-mut"
cd $S/wt-mut; echo "commit $(git rev-parse --short HEAD) parent $(git log -1 --format=%p HEAD)"
rm -rf packages/sdk-java/*/target; $S/build-arm.sh mut > $S/build-r8-cand.out 2>&1; echo "build exit=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $S/jars/cand-r8-stranded.jar
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dtest='ManagedRuntimeRetention*Test,RuntimeRetention*Test,RuntimeBrokerFlywaySchemaTest' \
  -Dsurefire.failIfNoSpecifiedTests=false -Dspotbugs.skip=true test checkstyle:check > $S/r8-cand-server.log 2>&1; echo "cand server targeted+checkstyle exit=$?"
grep -E 'Tests run: [0-9]+, F.*in |Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|You have [0-9]+ Checkstyle' $S/r8-cand-server.log | sed -E 's/, Time elapsed: [0-9.]+ s//;s/^\[(INFO|WARNING|ERROR)\] //' | tail -8
echo CAND-DONE
