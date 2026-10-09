#!/bin/bash
# usage (inside pr13174-linux:1): run-it-54.sh <label>   HostedPublicWorkspaceIT via -Phosted-harness-mysql on MySQL 8.4 (127.0.0.1:3545)
set -uo pipefail
export PATH=/rig/node/bin:$PATH
L=$1; OUT=/rig/out/$L; mkdir -p $OUT; T=/rig/tree; cd $T
MVN="mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=/rig/m2"
echo "label=$L node=$(node -v) java=$(java -version 2>&1 | head -1) start=$(date -u +%FT%TZ) itfix=$(grep -c 'Counted after the held Turn' packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/HostedPublicWorkspaceIT.java)" | tee $OUT/meta.txt
$MVN -q -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $OUT/install.log 2>&1; echo "qwencode rc=$?" | tee -a $OUT/meta.txt
$MVN -q -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install >> $OUT/install.log 2>&1; echo "broker rc=$?" | tee -a $OUT/meta.txt
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedPublicWorkspaceIT \
  -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dnode.executable=$(command -v node) -Dqwen.cli.entry=$T/dist/cli.js \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:3545/hosted_it_$L?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify > $OUT/verify.log 2>&1; echo "verify rc=$?" | tee -a $OUT/meta.txt
cp -r packages/sdk-java/managed-agent-server/target/failsafe-reports $OUT/ 2>/dev/null
grep -E "Tests run:|<<< (FAIL|ERR)|Expected size|\[ERROR\]   " $OUT/verify.log | head -20 | tee -a $OUT/meta.txt
echo "end=$(date -u +%FT%TZ) DONE" | tee -a $OUT/meta.txt
