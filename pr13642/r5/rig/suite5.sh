#!/bin/bash
# usage: suite5.sh <worktree-arm> <m2> <db: mysql|maria> <tag>   (server unit+IT in one pass; failures do not stop failsafe)
set -uo pipefail
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
WT=$S/wt-$1; REPO=$S/m2-$2; DB=$3; TAG=$4
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
if [ "$DB" = mysql ]; then PORT=33642; else PORT=43642; fi
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$REPO"
cd $WT
$MVN -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $S/suite-$TAG-qwencode.log 2>&1
$MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install > $S/suite-$TAG-broker-install.log 2>&1
$MVN -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration -Dmaven.test.failure.ignore=true \
  -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/ma_${TAG}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=pr13642 clean verify checkstyle:check > $S/suite-$TAG-server.log 2>&1
echo "server exit=$?"
