#!/bin/bash
# Isolated A/B for ToolPublicationStoreTest#streamsLargeOutputAndReadsItsTailAfterStoreReplacement: main 18f80f56 vs trial merge a6e3ea24, alternating, 3 runs each.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
(cd $S/wt-m10 && rm -rf packages/sdk-java/*/target) && $S/build-arm.sh m10 > $S/r10/build-m10.out 2>&1; echo "main build exit=$?"
T='ToolPublicationStoreTest#streamsLargeOutputAndReadsItsTailAfterStoreReplacement'
for i in 1 2 3; do
  for arm in m10 r8b; do
    [ $arm = m10 ] && name=main-18f80f56 || name=merge-a6e3ea24
    L=$S/r10/ab-tps-$name-$i.log
    (cd $S/wt-$arm && mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-$arm -f packages/sdk-java/managed-agent-server/pom.xml \
      -Dtest="$T" -Dsurefire.failIfNoSpecifiedTests=false -Dspotbugs.skip=true -Dcheckstyle.skip=true test > $L 2>&1)
    r=$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L | tail -1 | sed -E 's/^\[(INFO|WARNING|ERROR)\] //')
    [ -n "$r" ] || r="NO RESULT LINE (see $L)"
    echo "$name run $i: $r  load=$(uptime | sed -E 's/.*averages: //')"
  done
done
I='ToolPublicationAsyncVerificationMySqlIT#expiredAttemptDefersInsteadOfImmediatelyReclaiming'
for i in 1 2 3; do
  for arm in m10 r8b; do
    [ $arm = m10 ] && name=main-18f80f56 || name=merge-a6e3ea24
    L=$S/r10/ab-async-maria-$name-$i.log
    (cd $S/wt-$arm && mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-$arm -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration \
      -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="$I" \
      -Dmysql.url="jdbc:mysql://127.0.0.1:43642/ma_ab10_${arm}_$i?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pr13642 \
      -Dspotbugs.skip=true -Dcheckstyle.skip=true verify > $L 2>&1)
    r=$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $L | tail -1 | sed -E 's/^\[(INFO|WARNING|ERROR)\] //')
    [ -n "$r" ] || r="NO RESULT LINE (see $L)"
    echo "async-IT MariaDB $name run $i: $r  load=$(uptime | sed -E 's/.*averages: //')"
  done
done
echo AB-DONE
