#!/bin/bash
# Round 7: the main merge in the fix worktree — Flyway version uniqueness, SDK/Broker install, Checkstyle and
# the full managed-agent-server test run (offline, rig Maven repo).
WT=/Users/wenshao/git/pr13598-fix; R=/Users/wenshao/git/pr13598-rig; OUT=$R/results/r7/tests-raw/head-07add57a64-java.log; : > $OUT
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:$PATH
M2=$R/m2-head
cd $WT/packages/sdk-java/managed-agent-server/src/main/resources/db/migration
dups=$(ls V*__*.sql | sed -E 's/^V([0-9]+)__.*/\1/' | sort | uniq -d); echo "flyway duplicate versions: [${dups}] latest: $(ls V*__*.sql | sed -E 's/^V([0-9]+)__.*/\1/' | sort -n | tail -1)" >> $OUT
cd $WT
for m in qwencode runtime-broker; do
  (cd packages/sdk-java/$m && mvn -B -q -o -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dspotless.check.skip=true -Dgpg.skip -Dmaven.javadoc.skip=true -Dmaven.source.skip=true install) >> $OUT 2>&1 || { echo "INSTALL FAIL $m" >> $OUT; exit 1; }
done
(cd packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$M2 checkstyle:check) > $R/results/r7/tests-raw/head-07add57a64-checkstyle.log 2>&1; echo "CHECKSTYLE EXIT $?" >> $OUT
(cd packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotless.check.skip=true test) > $R/results/r7/tests-raw/head-07add57a64-java-test.log 2>&1; echo "JAVA TEST EXIT $?" >> $OUT
grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|<<< (FAILURE|ERROR)" $R/results/r7/tests-raw/head-07add57a64-java-test.log | tail -12 >> $OUT
echo "MERGE-JAVA-DONE $(date +%T)" >> $OUT
