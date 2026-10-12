#!/bin/bash
# Mutation arms for 5832d882's guard tests: head guard, 54bdbb50 quadratic guard, round-9 candidate (raw-only DISTINCT).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-r10b"
G=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedRuntimeRetentionGuard.java
T='settledBackgroundVolumeWithOtherSessionNoiseDoesNotTimeoutTheGuard+backgroundOwnersRemainDistinctUnderPermissiveCollation'
cd $S/wt-r10mut
res() { grep -E '^\[(ERROR|INFO|WARNING)\] (Tests run:|  [A-Za-z].*:[0-9]+|ManagedRuntime)|<<< (FAIL|ERR)' "$1" | sed -E 's/^\[(INFO|WARNING|ERROR)\] //; s/, Time elapsed: ([0-9.]+) s/ (\1 s)/' | grep -vE '^Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' | head -12; }
for arm in head quadratic r9cand; do
  cp $S/r10/mut/guard-$arm.java $G
  echo "=== arm $arm (guard sha $(shasum $G | cut -c1-10))"
  L=$S/r10/mut/$arm-h2.log
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dtest="ManagedRuntimeRetentionGuardTest#$T" -Dsurefire.failIfNoSpecifiedTests=false \
    -Dspotbugs.skip=true -Dcheckstyle.skip=true clean test > $L 2>&1; echo "--- H2 exit=$?"; res $L
  for DB in mysql maria; do
    [ $DB = mysql ] && PORT=33642 || PORT=43642
    L=$S/r10/mut/$arm-$DB.log
    $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
      -Dit.test="ManagedRuntimeRetentionGuardMySqlIT#$T" \
      -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/ma_mut10_${arm}_$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
      -Dspotbugs.skip=true -Dcheckstyle.skip=true verify > $L 2>&1; echo "--- $DB IT exit=$?"; res $L
  done
done
git checkout -q -- $G; git status --short | head -3
echo MUT-DONE
