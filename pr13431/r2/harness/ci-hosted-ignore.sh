#!/bin/bash
# usage: ci-hosted.sh <tree> <m2dir> <label> [it.test selector]
# Replays the Hosted process fault gates job steps that touch the PR files.
set -uo pipefail
export PATH=/rig/node/bin:$PATH
T=/rig/$1; M=/rig/$2; L=$3; SEL=${4:-}
OUT=/rig/out/$L; mkdir -p $OUT; : > $OUT/steps.txt
cd $T
MVN="mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$M"
step() { local name=$1; shift; local s=$(date +%s); "$@" > $OUT/$name.log 2>&1; local rc=$?; echo "STEP $name rc=$rc secs=$(( $(date +%s)-s ))" | tee -a $OUT/steps.txt; return $rc; }
echo "tree=$1 m2=$2 label=$L sel=$SEL node=$(node -v) start=$(date -u +%FT%TZ)" | tee $OUT/meta.txt
git log --oneline -1 >> $OUT/meta.txt
mysql -h127.0.0.1 -P3432 -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS hosted_harness_test; CREATE DATABASE hosted_harness_test" 2>&1 | grep -v Warning
step install-qwencode $MVN -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install
step install-broker $MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install
if [ -f integration-tests/helpers/hosted-relay-headers.test.ts ]; then
  step relay-test bash -c "cd integration-tests && npx vitest run helpers/hosted-relay-headers.test.ts"
fi
EXTRA=""
[ -n "$SEL" ] && EXTRA="-Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=$SEL"
step verify $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dmaven.test.failure.ignore=true $EXTRA \
  -Dnode.executable=$(command -v node) -Dqwen.cli.entry=$T/dist/cli.js \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:3432/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify $([ -z "$SEL" ] && echo checkstyle:check)
if [ -z "$SEL" ]; then
  step failsafe-check node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server
  step latency bash -c "test -s packages/sdk-java/managed-agent-server/target/hosted-latency-baseline.json && cd integration-tests && npx vitest run cli/hosted-latency-baseline.test.ts"
fi
cp -r packages/sdk-java/managed-agent-server/target/failsafe-reports $OUT/ 2>/dev/null
cp packages/sdk-java/managed-agent-server/target/hosted-latency-baseline.json $OUT/ 2>/dev/null
echo "end=$(date -u +%FT%TZ)" >> $OUT/meta.txt
echo DONE >> $OUT/steps.txt
