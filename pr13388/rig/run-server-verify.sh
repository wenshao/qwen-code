#!/bin/bash
# Usage: run-server-verify.sh <arm> <tag>  — PR test plan step 4c: full managed-agent-server verify + burst IT on MySQL 8.4.7
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad
ARM=$1; TAG=${2:-r1}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd $S/wt-$ARM/packages/sdk-java || exit 2
DB="p13388_${ARM}_${TAG}_$(date +%H%M%S)"
LOG=$S/it/$ARM-$TAG.log
echo "arm=$ARM tag=$TAG head=$(git rev-parse --short HEAD) dirty=$(git status --porcelain | tr '\n' ' ') db=$DB" > $LOG
t0=$(date +%s)
mvn -B -o -Dmaven.repo.local=$S/m2/$ARM -Dgpg.skip -Phosted-harness-mysql -Dit.test=HostedConcurrentTurnBurstMySqlIT -Djava.io.tmpdir=$S/it/tmp-$ARM-$TAG \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13388/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -f managed-agent-server/pom.xml verify checkstyle:check >> $LOG 2>&1
rc=$?; t1=$(date +%s)
echo "exit=$rc wall=$((t1-t0))s" >> $LOG
echo "$ARM $TAG exit=$rc wall=$((t1-t0))s | unit: $(grep -a -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $LOG | head -1 | sed 's/.*Tests run/Tests run/') | IT: $(grep -a -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $LOG | tail -1 | sed 's/.*Tests run/Tests run/') | clean rounds: $(grep -a -c 'admissionFailures=0' $LOG) | $(grep -a -o 'You have [0-9]* Checkstyle violations' $LOG | tail -1)"
