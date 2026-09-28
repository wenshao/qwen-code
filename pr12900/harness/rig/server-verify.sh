#!/bin/bash
# CI step "Run Managed Agent tests, Checkstyle, and MySQL integration" + report check
# usage: server-verify.sh <worktree> <port> <password> <dbname>
source "$(dirname "$0")/env.sh"
WT=$1; PORT=$2; PW=$3; DB=$4
cd "$WT/packages/sdk-java/managed-agent-server" || exit 2
"${MVN[@]}" -Pmysql-integration \
  -Dmysql.url="jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password="$PW" clean verify checkstyle:check
rc=$?
echo "MAVEN_EXIT=$rc"
cd "$WT" && node scripts/check-failsafe-reports.js non-hosted packages/sdk-java/runtime-broker packages/sdk-java/managed-agent-server
echo "REPORT_CHECK_EXIT=$?"
exit $rc
