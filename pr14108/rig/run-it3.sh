#!/bin/bash
# usage: run-it.sh <lane> <arm> <tag> [it.test|ALL]
# CI "Verify Hosted Java, Spring and MySQL processes" step (clean verify, -Phosted-harness-mysql, pom fork timeout untouched)
# minus surefire unit tests/checkstyle/spotbugs, inside qwen-managed-e2e:u24 (Node 22, JDK 21) pinned to the lane cpus.
L=$1; A=$2; TAG=$3; T=${4:-HostedShellLifecycleRecoveryIT}; R=/root/pr14108-rig; DB=it_${A}_${TAG//[^a-zA-Z0-9]/_}
case $L in a) C=0-3;; b) C=4-7;; esac
docker exec pr14108-db-$L mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
SEL="-Dit.test=$T"; [ "$T" = ALL ] && SEL=""
echo "=== $(date -u +%FT%TZ) IT lane=$L arm=$A tag=$TAG sel=$T db=$DB"
start=$(date +%s)
docker run --rm --init --name pr14108-it-$A-$TAG --network pr14108net --cpuset-cpus $C --memory ${MEM:-10g} --memory-swap ${MEM:-10g} \
  -v $R:$R -v /etc/machine-id:/etc/machine-id:ro qwen-managed-e2e:u24 bash -c "
  cd $R/src-$A/packages/sdk-java/managed-agent-server &&
  mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$R/m2 -Phosted-harness-mysql \
    -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
    $SEL -Dnode.executable=\$(command -v node) -Dqwen.cli.entry=$R/src-$A/dist/cli.js \
    -Dmysql.url=\"jdbc:mysql://pr14108-db-$L:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false\" \
    -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify" > $R/out/it-$A-$TAG.log 2>&1
rc=$?
echo "[$A $TAG] it exit=$rc wall=$(( $(date +%s) - start ))s"
mkdir -p $R/out/fs-$A-$TAG && cp -r $R/src-$A/packages/sdk-java/managed-agent-server/target/failsafe-reports/. $R/out/fs-$A-$TAG/ 2>/dev/null
rm -f $R/src-$A/packages/sdk-java/managed-agent-server/target/*.jar
docker exec pr14108-db-$L mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB" 2>&1 | grep -v Warning
grep -E "Tests run:|<<< (FAIL|ERR)|but was|timeout in the fork|kill self fork|L4_SHELL_RECOVERY_OK|BUILD (SUCCESS|FAILURE)" $R/out/it-$A-$TAG.log | cut -c1-220 | head -40
