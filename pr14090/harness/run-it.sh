#!/bin/bash
# usage: run-it.sh <arm> <tag> [it.test]  -- CI "Hosted process fault gates" verify step narrowed to one IT selector,
# inside qwen-managed-e2e:u24 on a private docker network with mysql:8.4 (no published ports).
A=$1; TAG=$2; T=${3:-HostedWorkspaceToolTurnIT#operatorRecoveryReleasesOnlyTheOriginalQuiescentShellOnMySql}
R=/root/pr14090-rig; DB=it_${A}_${TAG//[^a-zA-Z0-9]/_}
docker exec pr14090-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
echo "=== $(date +%T) IT $A $TAG sel=$T db=$DB"
docker run --rm --init --name pr14090-it-$A-$TAG --network pr14090net --memory 6g --memory-swap 6g \
  -v $R:$R -v /etc/machine-id:/etc/machine-id:ro qwen-managed-e2e:u24 bash -c "
  cd $R/j-$A/packages/sdk-java/managed-agent-server &&
  mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$R/m2 -Phosted-harness-mysql \
    -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
    -Dit.test='$T' -Dnode.executable=\$(command -v node) -Dqwen.cli.entry=$R/src-base/dist/cli.js \
    -Dmysql.url='jdbc:mysql://pr14090-db:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false' \
    -Dmysql.user=root -Dmysql.password=hosted-fixture verify" > $R/out/it-$A-$TAG.log 2>&1
echo "[$A $TAG] it exit=$?"
mkdir -p $R/out/fs-$A-$TAG && cp -r $R/j-$A/packages/sdk-java/managed-agent-server/target/failsafe-reports/. $R/out/fs-$A-$TAG/ 2>/dev/null
grep -E "Tests run:|<<< (FAIL|ERR)|but was" $R/out/it-$A-$TAG.log | head -20
