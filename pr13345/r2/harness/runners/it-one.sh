#!/bin/bash
# usage: it-one.sh <tree dir> <tag> <port> <db> [mvn wrapper]   runs ManagedAgentMySqlIT only
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
T=$1; TAG=$2; PORT=$3; DB=$4; MVN=${5:-$S/mvn.sh}
[ -d "$T" ] && [ -n "$DB" ] || { echo usage; exit 2; }
cd $T/packages/sdk-java/managed-agent-server || exit 2
rm -rf target/failsafe-reports
$MVN -o verify -Pmysql-integration -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=ManagedAgentMySqlIT \
  -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=rig13345 -Duser.timezone=UTC > $S/r2/logs/it-$TAG.log 2>&1
echo "exit=$?" >> $S/r2/logs/it-$TAG.log
node $S/mut/summarize-java.mjs target/failsafe-reports $S/r2/logs/it-$TAG.log $TAG it it
grep -o 'admitsHookExecutionsWithoutReadingTheirHistoryOnMySql" classname="[^"]*" time="[^"]*"' target/failsafe-reports/TEST-*MySqlIT.xml | sed 's/.*time=/hookAdmissionCase time=/'
