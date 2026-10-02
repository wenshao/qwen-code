#!/bin/bash
# usage: gate.sh <worktree> <label> [m2]  -- CI-equivalent managed-agent-server verify on the gate mysqld (23184)
W=$1; L=$2; export M2=${3:-/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/m2-merge}
cd $W
echo "== gate $L $(git rev-parse --short HEAD) $(date +%T)"
/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/mvn.sh -o -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install -q || exit 1
/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/mvn.sh -o -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install -q || exit 1
cd packages/sdk-java/managed-agent-server
/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad/rig/mvn.sh -o -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:23184/managed_agent_test_$L?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=gate13084 clean verify checkstyle:check
echo "== exit $? $(date +%T)"
