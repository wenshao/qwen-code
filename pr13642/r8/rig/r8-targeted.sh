#!/bin/bash
# round 8 trial merge 8b72c287 (6f5f7f6a + main da224e61): targeted H2 tests + checkstyle, then MySQL-profile ITs on both engines
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-main2"
cd $S/wt-main2; echo "commit $(git rev-parse --short HEAD) parents $(git log -1 --format=%p HEAD)"
sum() { grep -E 'Tests run: [0-9]+, F.*in |Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|You have [0-9]+ Checkstyle|ERROR\]   [A-Za-z]' "$1" | sed -E 's/, Time elapsed: [0-9.]+ s//;s/^\[(INFO|WARNING|ERROR)\] //' | tail -${2:-14}; }
$MVN -f packages/sdk-java/runtime-broker/pom.xml -Dtest='JdbcRuntimeRetention*Test,JdbcPlacementGuard*,RuntimeHarnessDrainTest,JdbcRepositoryTest,ManagedMonitorProtocolTest,RuntimeBrokerServiceTest' \
  -Dsurefire.failIfNoSpecifiedTests=false -Dspotbugs.skip=true test > $S/r8-broker-h2.log 2>&1; echo "== broker targeted H2 exit=$?"; sum $S/r8-broker-h2.log 9
$MVN -f packages/sdk-java/managed-agent-server/pom.xml \
  -Dtest='RuntimeBrokerFlywaySchemaTest,ManagedRuntimeRetention*Test,RuntimeRetention*Test,ToolPublicationStoreTest,ManagedAgentPropertiesTest,WorkspaceRuntimeTest,ManagedActionsTest,ToolPublicationControllerTest' \
  -Dsurefire.failIfNoSpecifiedTests=false -Dspotbugs.skip=true test checkstyle:check > $S/r8-server-h2.log 2>&1; echo "== server targeted H2 + checkstyle exit=$?"; sum $S/r8-server-h2.log 14
for DB in mysql maria; do
  [ $DB = mysql ] && PORT=33642 || PORT=43642
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -Pmysql-integration -Dtest=JdbcRuntimeRetentionTest -Dit.test='JdbcRuntimeRetentionMySqlIT,JdbcRuntimeBrokerMySqlIT' \
    -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/rb_r8t_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
    -Dspotbugs.skip=true verify > $S/r8-broker-it-$DB.log 2>&1; echo "== broker IT $DB exit=$?"; sum $S/r8-broker-it-$DB.log 6
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
    -Dit.test='ToolPublicationLockOrderMySqlIT,ManagedRuntimeRetentionRaceMySqlIT,ManagedRuntimeRetentionGuardMySqlIT,ToolPublicationRecoveryMySqlIT,WorkspaceMigrationMySqlIT' \
    -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/ma_r8t_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
    -Dspotbugs.skip=true verify > $S/r8-server-it-$DB.log 2>&1; echo "== server IT $DB exit=$?"; sum $S/r8-server-it-$DB.log 8
done
echo TARGETED-DONE
