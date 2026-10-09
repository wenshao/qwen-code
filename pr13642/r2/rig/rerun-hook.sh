#!/bin/bash
# usage: rerun-hook.sh <worktree-arm> <m2> <mysql|maria> <tag>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
WT=$S/wt-$1; REPO=$S/m2-$2; DB=$3; TAG=$4
[ "$DB" = mysql ] && PORT=33642 || PORT=43642
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
cd $WT && git log --oneline -1 > $S/rerun-hook-$TAG.log && mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$REPO -f packages/sdk-java/managed-agent-server/pom.xml -Pmysql-integration \
  -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/ma_hook_${TAG}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=pr13642 -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dspotbugs.skip=true \
  -Dit.test='ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql' verify >> $S/rerun-hook-$TAG.log 2>&1
echo "$TAG exit=$? $(head -1 $S/rerun-hook-$TAG.log | cut -c1-10) $(grep -E 'Tests run: [0-9]+, F.*[0-9]$' $S/rerun-hook-$TAG.log | tail -1) $(grep -m1 -o 'ApiException: [^.]*' $S/rerun-hook-$TAG.log)"
