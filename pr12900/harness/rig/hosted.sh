#!/bin/bash
# CI step "Verify Hosted Java, Spring and MySQL processes" + report check
# usage: hosted.sh <worktree> <db> <cli-worktree>
source "$(dirname "$0")/env.sh"
WT=$1; DB=$2; CLIWT=${3:-$1}
docker exec v12900-mysql84 mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>/dev/null
cd "$WT" || exit 2
"${MVN[@]}" -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql \
  -Dnode.executable="$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node" -Dqwen.cli.entry="$CLIWT/dist/cli.js" \
  -Dmysql.url="jdbc:mysql://127.0.0.1:33984/$DB?allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify checkstyle:check
rc=$?; echo "MAVEN_EXIT=$rc"
node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server; echo "REPORT_CHECK_EXIT=$?"
exit $rc
