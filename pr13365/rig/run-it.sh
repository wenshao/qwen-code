#!/bin/bash
# Usage: run-it.sh <arm> <rep> ; runs only HostedConcurrentTurnBurstMySqlIT in wt-<arm>
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/82bd70be-da86-4042-ac1d-b63b9f729043/scratchpad
ARM=$1; REP=$2
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd $SP/wt-$ARM || exit 2
DB="p13365_${ARM}_r${REP}_$(date +%H%M%S)"
LOG=$SP/it/$ARM-r$REP.log
echo "arm=$ARM rep=$REP head=$(git rev-parse --short HEAD) dirty=$(git status --porcelain | tr '\n' ' ') db=$DB" > $LOG
mvn -B -o -Dmaven.repo.local=$SP/m2/repository -Phosted-harness-mysql -Dit.test=HostedConcurrentTurnBurstMySqlIT \
  -Dtest=NoSuchTestPlease -Dsurefire.failIfNoSpecifiedTests=false -Djava.io.tmpdir=$SP/it/tmp-$ARM-r$REP \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13365/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -f packages/sdk-java/managed-agent-server/pom.xml verify >> $LOG 2>&1
echo "exit=$?" >> $LOG
echo "$(date +%H:%M:%S) $ARM r$REP: $(grep -c 'admissionFailures=0' $LOG)/6 rounds clean, $(tail -1 $LOG)"
