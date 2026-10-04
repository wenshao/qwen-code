#!/bin/bash
# usage: run-it.sh <arm-file-in-arms/> <case|all> <mode|-> <tag>
set -u
ARM=$1; CASE=$2; MODE=$3; TAG=$4
R=/root/verify/pr13380; W=${WT:-$R/head}; OUT=$R/runs/$TAG; mkdir -p $OUT
cp $R/arms/$ARM $W/integration-tests/helpers/hosted-process-crash-driver.ts
cp $R/arms/verify13380.ts $W/integration-tests/helpers/verify13380.ts
DB=h13380_$(echo $TAG | tr -c 'a-zA-Z0-9\n' '_')
docker exec my13380 mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>/dev/null
export JAVA_HOME=/usr/local/jdk21 PATH=/usr/local/jdk21/bin:$PATH
[ "$MODE" != "-" ] && export VERIFY13380_MODE=$MODE VERIFY13380_OUT=$OUT/verify.jsonl
CASEARG=""; [ "$CASE" != "all" ] && CASEARG="-Dqwen.fg6c.case=$CASE"
cd $W/packages/sdk-java/managed-agent-server
T0=$(date +%s)
mvn -B --no-transfer-progress -Dmaven.repo.local=${M2:-$R/m2} -Dmaven.repo.local.tail=/root/.m2/repository \
  -Phosted-process-crashes test-compile failsafe:integration-test failsafe:verify \
  -Dcheckstyle.skip=true -Dspotbugs.skip=true $CASEARG \
  -Dnode.executable="$(command -v node)" -Dqwen.cli.entry=$W/dist/cli.js \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33380/$DB?allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=hosted-fixture > $OUT/mvn.log 2>&1
RC=$?
cp -r target/failsafe-reports $OUT/ 2>/dev/null
echo "arm=$ARM case=$CASE mode=$MODE rc=$RC secs=$(( $(date +%s)-T0 ))" | tee $OUT/RESULT
git -C $W checkout -q -- integration-tests/helpers/hosted-process-crash-driver.ts
rm -f $W/integration-tests/helpers/verify13380.ts
exit $RC
