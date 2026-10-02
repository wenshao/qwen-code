#!/bin/bash
# usage: gate.sh <worktree> <label>   unit (clean verify checkstyle:check) then -Pmysql-integration on gate mysqld 43226
W=$1; L=$2; M=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/rig/mvn.sh; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $W || exit 2
echo "== $L $(git rev-parse HEAD) unit start $(date +%T)"
TZ=UTC $M -o -f packages/sdk-java/managed-agent-server/pom.xml clean verify checkstyle:check > /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/unit-$L.log 2>&1; echo "== unit exit=$? $(date +%T)"
grep -E "Tests run:.*Fail.*Err.*Skip.*$" /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/unit-$L.log | grep -v " in com" | tail -2; grep -E "BUILD|violation" /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/unit-$L.log | tail -2
mkdir -p /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/surefire-$L && cp -R packages/sdk-java/managed-agent-server/target/surefire-reports/. /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/surefire-$L/ 2>/dev/null
echo "== $L mysql-integration start $(date +%T)"
TZ=UTC $M -o -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:43226/managed_agent_test_$L?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pw13225 -Dtest=NoUnitTestsHere -Dsurefire.failIfNoSpecifiedTests=false verify > /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/it-$L.log 2>&1; echo "== it exit=$? $(date +%T)"
grep -E "Tests run:|BUILD" /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/it-$L.log | grep -v " in com" | tail -3
$NODE scripts/check-failsafe-reports.js non-hosted packages/sdk-java/managed-agent-server 2>&1 | tail -3; echo "checker exit=$?"
mkdir -p /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/failsafe-$L && cp -R packages/sdk-java/managed-agent-server/target/failsafe-reports/. /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/logs/failsafe-$L/ 2>/dev/null
