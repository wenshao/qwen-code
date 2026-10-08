#!/bin/bash
# usage: mutate.sh <mutant> <mysql|maria>   (runs in wt-mut; reverts afterwards)
S=$SCRATCH
WT=$S/wt-mut; M=$1; DB=$2; [ "$DB" = mysql ] && PORT=33642 || PORT=43642
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
B=packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker
T=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store
case $M in
  M1) F=$T/ToolPublicationStore.java; FROM='                JdbcRuntimeBindingRepository.lockPlacementDomain(target, tenantId);\n'; TO='';;
  M2) F=$B/JdbcRuntimeBindingRepository.java; FROM='AND CAST(tenant_id AS BINARY(2048)) = CAST(? AS BINARY(2048)) '; TO='AND tenant_id = ? ';;
  M3) F=$B/JdbcRuntimeBindingRepository.java; FROM='OR CAST(storage_id AS BINARY(2048)) = CAST(? AS BINARY(2048)) '; TO='OR storage_id = ? ';;
  M4) F=$B/JdbcRuntimeBindingRepository.java; FROM='CAST(provisioner_kind AS BINARY(2048)) <> CAST(? AS BINARY(2048)) '; TO='provisioner_kind <> ? ';;
  M5) F=$B/JdbcRuntimeRetention.java; FROM='\n                        && !references.executionReferenced(connection, row.callId())'; TO='';;
  M6) F=$B/JdbcRuntimeRetention.java; FROM='if (binding == null || !eligible(binding, cutoff, now)\n                || operatorReferenced(connection, binding)\n'; TO='if (binding == null || !eligible(binding, cutoff, now)\n';;
  M7) F=$B/JdbcRuntimeRetention.java; FROM='        JdbcRuntimeBindingRepository.lockPlacementDomain(connection, candidate.tenantId(), 10);\n'; TO='';;
esac
cd $WT; git checkout -q -- packages/sdk-java
FROM="$FROM" TO="$TO" perl -0 -i -pe 'BEGIN{$f=$ENV{FROM}; $t=$ENV{TO}; $f=~s/\\n/\n/g; $t=~s/\\n/\n/g} $n += s/\Q$f\E/$t/g; END{ print STDERR "replacements=$n\n" }' $F 2> $S/mut-$M-$DB.subst
N=$(grep -o 'replacements=[0-9]*' $S/mut-$M-$DB.subst | cut -d= -f2)
if [ "$N" != 1 ]; then echo "$M $DB: SUBSTITUTION FAILED ($N)"; git checkout -q -- packages/sdk-java; exit 1; fi
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-mut -Pmysql-integration -Dmysql.user=root -Dmysql.password=pr13642 -Dspotbugs.skip=true -DfailIfNoTests=false"
URL="jdbc:mysql://127.0.0.1:$PORT/mut_${M}_${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
if [ $M = M1 ]; then
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dmysql.url="$URL" -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=ToolPublicationRecoveryMySqlIT verify > $S/mut-$M-$DB-it.log 2>&1; IT=$?
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dmysql.url="$URL" -Dtest=ToolPublicationStoreTest test > $S/mut-$M-$DB-unit.log 2>&1; UNIT=$?
elif [ $M = M5 ] || [ $M = M6 ] || [ $M = M7 ]; then
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -Dmysql.url="$URL" -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=JdbcRuntimeRetentionMySqlIT verify > $S/mut-$M-$DB-it.log 2>&1; IT=$?
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -Dtest=JdbcRuntimeRetentionTest test > $S/mut-$M-$DB-unit.log 2>&1; UNIT=$?
  # managed-server race IT against the mutated broker
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > $S/mut-$M-$DB-install.log 2>&1
  $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dmysql.url="$URL" -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=ManagedRuntimeRetentionRaceMySqlIT verify > $S/mut-$M-$DB-race.log 2>&1; RACE=$?
  git checkout -q -- packages/sdk-java; $MVN -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install > /dev/null 2>&1
else
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -Dmysql.url="$URL" -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=JdbcRuntimeRetentionMySqlIT verify > $S/mut-$M-$DB-it.log 2>&1; IT=$?
  $MVN -f packages/sdk-java/runtime-broker/pom.xml -Dtest=JdbcPlacementGuardTest test > $S/mut-$M-$DB-unit.log 2>&1; UNIT=$?
fi
git checkout -q -- packages/sdk-java
k() { [ "$1" = 0 ] && echo SURVIVED || echo killed; }
first() { grep -m1 -E "AssertionFailedError|expected:|Exception:|<<< (FAILURE|ERROR)" $1 2>/dev/null | cut -c1-150; }
echo "$M $DB | real-DB IT: $(k $IT) | H2 unit: $(k $UNIT)${RACE:+ | server race IT: $(k $RACE)}"
[ "$IT" != 0 ] && echo "    IT: $(first $S/mut-$M-$DB-it.log)"
