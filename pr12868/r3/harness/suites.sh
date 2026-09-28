#!/bin/bash
# Runs the repository's own suites for one worktree, sequentially.
SCRATCH=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad
WT=$1; TAG=$2; shift 2
L=$SCRATCH/logs/suites-$TAG; mkdir -p $L
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export PATH=$(dirname $NODE):$PATH
MY="allowPublicKeyRetrieval=true&useSSL=false"
cd $WT || exit 1
echo "head=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ') start=$(date +%T)"
for s in "$@"; do
  t0=$(date +%s)
  case $s in
    broker-unit) $SCRATCH/bin/mvnw.sh -f packages/sdk-java/runtime-broker/pom.xml test > $L/$s.log 2>&1 ;;
    fault-gates) $SCRATCH/bin/mvnw.sh -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates -Dqwen.cli.entry=$WT/dist/cli.js test > $L/$s.log 2>&1 ;;
    broker-mysql) $SCRATCH/bin/mvnw.sh -f packages/sdk-java/runtime-broker/pom.xml -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:13868/runtime_broker_test_$TAG?createDatabaseIfNotExist=true&$MY" -Dmysql.user=root -Dmysql.password=rig12868 verify > $L/$s.log 2>&1 ;;
    server-mysql) $SCRATCH/bin/mvnw.sh -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:13868/managed_agent_test_$TAG?createDatabaseIfNotExist=true&$MY" -Dmysql.user=root -Dmysql.password=rig12868 verify checkstyle:check > $L/$s.log 2>&1 ;;
    hosted-mysql) $SCRATCH/bin/mvnw.sh -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dnode.executable=$NODE -Dqwen.cli.entry=$WT/dist/cli.js "-Dmysql.url=jdbc:mysql://127.0.0.1:13868/hosted_harness_test_$TAG?createDatabaseIfNotExist=true&$MY" -Dmysql.user=root -Dmysql.password=rig12868 verify > $L/$s.log 2>&1 ;;
    broker-checkstyle) $SCRATCH/bin/mvnw.sh -f packages/sdk-java/runtime-broker/pom.xml checkstyle:check > $L/$s.log 2>&1 ;;
    ts-serve) (cd packages/cli && npx vitest run src/serve > $L/$s.log 2>&1) ;;
    ts-core) (cd packages/core && npx vitest run src/tools/managed-tool > $L/$s.log 2>&1) ;;
  esac
  rc=$?
  echo "$s rc=$rc $(( $(date +%s) - t0 ))s"
done
echo "head=$(git rev-parse HEAD) dirty=$(git status --short | wc -l | tr -d ' ') end=$(date +%T)"
