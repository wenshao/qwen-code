#!/bin/bash
# usage: it-one.sh <arm> <port> <db> <tag>   runs ManagedAgentMySqlIT only
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
ARM=$1; PORT=$2; DB=$3; TAG=$4
[ -n "$TAG" ] || exit 2
cd $S/wt-$ARM/packages/sdk-java/managed-agent-server || exit 2
rm -rf target/failsafe-reports
$S/mvn.sh -o verify -Pmysql-integration -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=ManagedAgentMySqlIT \
  -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=rig13345 -Duser.timezone=UTC > $S/logs/it-$TAG.log 2>&1
echo "exit=$?" >> $S/logs/it-$TAG.log
node $S/mut/summarize-java.mjs target/failsafe-reports $S/logs/it-$TAG.log $ARM $TAG it
grep -o 'admitsHookExecutionsWithoutReadingTheirHistoryOnMySql" classname="[^"]*" time="[^"]*"' target/failsafe-reports/TEST-*MySqlIT.xml | sed 's/.*time=/hookAdmissionCase time=/'
