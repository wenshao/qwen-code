#!/bin/bash
# New head 18c8a418 merged into main aaf97b86 (trial merge 758f0c77): build jar, unit suites (H2) + checkstyle, then targeted ITs on both engines
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-r8b"
cd $S/wt-r8b; echo "commit $(git rev-parse --short HEAD) parents $(git log -1 --format=%p HEAD)"
rm -rf packages/sdk-java/*/target; $S/build-arm.sh r8b > $S/build-r8c.out 2>&1; echo "build exit=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $S/jars/merge-r8c-758f0c77.jar && echo JAR-READY
sum() { grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|You have [0-9]+ Checkstyle|ERROR\]   [A-Za-z]' "$1" | sed -E 's/^\[(INFO|WARNING|ERROR)\] //' | tail -${2:-8}; }
$MVN -f packages/sdk-java/runtime-broker/pom.xml -Dspotbugs.skip=true test > $S/r8c-broker-unit.log 2>&1; echo "== broker unit exit=$?"; sum $S/r8c-broker-unit.log 4
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true test checkstyle:check > $S/r8c-server-unit.log 2>&1; echo "== server unit + checkstyle exit=$?"; sum $S/r8c-server-unit.log 8
for DB in mysql maria; do
  [ $DB = mysql ] && PORT=33642 || PORT=43642
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
    -Dit.test='ToolPublicationLockOrderMySqlIT,ManagedRuntimeRetentionRaceMySqlIT,ManagedRuntimeRetentionGuardMySqlIT,ToolPublicationRecoveryMySqlIT,WorkspaceMigrationMySqlIT' \
    -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/ma_r8c_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
    -Dspotbugs.skip=true verify > $S/r8c-server-it-$DB.log 2>&1; echo "== server IT $DB exit=$?"; sum $S/r8c-server-it-$DB.log 3
done
echo R8C-DONE
