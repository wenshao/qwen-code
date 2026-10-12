#!/bin/bash
# Round 10: trial merge a6e3ea24 = PR 54bdbb50 + main 18f80f56. Build jar, compare classes with the R9 jar, unit suites, targeted ITs on both engines.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-r8b"
cd $S/wt-r8b; echo "merge $(git rev-parse --short HEAD) parents $(git log -1 --format=%p HEAD) tree $(git rev-parse --short HEAD^{tree})"
[ "$(git rev-parse HEAD^{tree})" = 45e5f5de92b85b3c47cd79b7784dcc97436f2484 ] || { echo "TREE MISMATCH"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "DIRTY WORKTREE"; git status --short | head; exit 1; }
rm -rf packages/sdk-java/*/target; $S/build-arm.sh r8b > $S/r10/build.out 2>&1; echo "build exit=$?"
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $S/jars/merge-r10-a6e3ea24.jar && echo JAR-READY
sum() { grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|You have [0-9]+ Checkstyle|ERROR\]   [A-Za-z]|FAILURE!$' "$1" | sed -E 's/^\[(INFO|WARNING|ERROR)\] //' | tail -${2:-8}; }
$MVN -f packages/sdk-java/runtime-broker/pom.xml -Dspotbugs.skip=true test > $S/r10/broker-unit.log 2>&1; echo "== broker unit exit=$?"; sum $S/r10/broker-unit.log 4
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dspotbugs.skip=true -Dmaven.test.failure.ignore=true test checkstyle:check > $S/r10/server-unit.log 2>&1; echo "== server unit + checkstyle exit=$?"; sum $S/r10/server-unit.log 8
for DB in mysql maria; do
  [ $DB = mysql ] && PORT=33642 || PORT=43642
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
    -Dit.test='ToolPublicationLockOrderMySqlIT,ManagedRuntimeRetentionRaceMySqlIT,ManagedRuntimeRetentionGuardMySqlIT,ToolPublicationRecoveryMySqlIT,WorkspaceMigrationMySqlIT,ToolPublicationAsyncVerificationMySqlIT' \
    -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/ma_r10_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
    -Dspotbugs.skip=true verify > $S/r10/server-it-$DB.log 2>&1; echo "== server IT $DB exit=$?"; sum $S/r10/server-it-$DB.log 3
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -Pmysql-integration -Dtest=BrokerValuesTest -Dit.test='JdbcRuntimeRetentionMySqlIT' \
    -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/rb_r10_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
    -Dspotbugs.skip=true verify > $S/r10/broker-it-$DB.log 2>&1; echo "== broker retention IT $DB exit=$?"; sum $S/r10/broker-it-$DB.log 3
done
echo R10-DONE
