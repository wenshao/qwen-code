#!/bin/bash
# usage: run-it.sh <lane a|b> <arm> <tag> <mode fs|ci> [it.test]
#  ci = the exact CI "Verify Hosted Java, Spring and MySQL processes" command (clean verify checkstyle:check,
#       unit tests + spotbugs + checkstyle + failsafe, pom fork timeouts untouched)
#  fs = same profile/properties, failsafe only (unit tests, checkstyle, spotbugs skipped)
# Runs in qwen-managed-e2e:u24 (Ubuntu 24.04, Node 22, JDK 21), 4 pinned cpus, /tmp bound to host ext4.
L=$1; A=$2; TAG=$3; MODE=$4; T=${5:-}; R=/root/pr14131-rig; DB=it_${A}_${TAG//[^a-zA-Z0-9]/_}
case $L in a) C=0-3;; b) C=4-7;; esac
docker exec pr14131-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
EXTRA="${EXTRA_MVN:-}"; [ "$MODE" = fs ] && EXTRA="$EXTRA -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false"
GOALS="clean verify"; [ "$MODE" = ci ] && GOALS="clean verify checkstyle:check"
SEL=""; [ -n "$T" ] && SEL="-Dit.test=$T"
TMP=$R/tmp-$A-$TAG; rm -rf $TMP; mkdir -p $TMP; chmod 1777 $TMP
echo "=== $(date -u +%FT%TZ) IT lane=$L arm=$A tag=$TAG mode=$MODE sel=${T:-ALL} db=$DB"
start=$(date +%s)
docker run --rm --init --name pr14131-it-$A-$TAG --network pr14131net --cpuset-cpus $C --memory ${MEM:-5g} --memory-swap ${MEM:-5g} \
  -e QWEN_E2E_REGISTER_STORAGE=1 -v $R:$R -v $TMP:/tmp -v /etc/machine-id:/etc/machine-id:ro qwen-managed-e2e:u24 bash -c "
  cd $R/src-$A && echo \"kernel=\$(uname -r) tmpfs=\$(stat -f -c %T /tmp) java=\$(java -version 2>&1 | head -1) node=\$(node -v)\" &&
  mvn --batch-mode --no-transfer-progress -s /root/pr14131-rig/settings.xml -Dmaven.repo.local=${M2:-$R/m2} \
    -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql $EXTRA $SEL \
    -Dnode.executable=\$(command -v node) -Dqwen.cli.entry=$R/src-$A/dist/cli.js \
    -Dmysql.url=\"jdbc:mysql://pr14131-db:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false\" \
    -Dmysql.user=root -Dmysql.password=hosted-fixture $GOALS" > $R/out/it-$A-$TAG.log 2>&1
rc=$?
echo "[$A $TAG] it exit=$rc wall=$(( $(date +%s) - start ))s"
mkdir -p $R/out/fs-$A-$TAG && cp -r $R/src-$A/packages/sdk-java/managed-agent-server/target/failsafe-reports/. $R/out/fs-$A-$TAG/ 2>/dev/null
grep -E "Tests run: [0-9]+, Fail.*Skipped: [0-9]+$|<<< (FAIL|ERR)|BUILD (SUCCESS|FAILURE)|Checkstyle violations" $R/out/it-$A-$TAG.log | cut -c1-200 | head -40
