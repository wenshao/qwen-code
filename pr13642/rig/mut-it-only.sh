#!/bin/bash
# Re-run only the runtime-broker real-DB IT per mutant (unit/race results already valid).
S=$SCRATCH
WT=$S/wt-mut; export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
B=packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker
cd $WT
for M in BASELINE M2 M3 M4 M5 M6 M7; do
  case $M in
    BASELINE) F=; FROM=; TO=;;
    M2) F=$B/JdbcRuntimeBindingRepository.java; FROM='AND CAST(tenant_id AS BINARY(2048)) = CAST(? AS BINARY(2048)) '; TO='AND tenant_id = ? ';;
    M3) F=$B/JdbcRuntimeBindingRepository.java; FROM='OR CAST(storage_id AS BINARY(2048)) = CAST(? AS BINARY(2048)) '; TO='OR storage_id = ? ';;
    M4) F=$B/JdbcRuntimeBindingRepository.java; FROM='CAST(provisioner_kind AS BINARY(2048)) <> CAST(? AS BINARY(2048)) '; TO='provisioner_kind <> ? ';;
    M5) F=$B/JdbcRuntimeRetention.java; FROM='\n                        && !references.executionReferenced(connection, row.callId())'; TO='';;
    M6) F=$B/JdbcRuntimeRetention.java; FROM='if (binding == null || !eligible(binding, cutoff, now)\n                || operatorReferenced(connection, binding)\n'; TO='if (binding == null || !eligible(binding, cutoff, now)\n';;
    M7) F=$B/JdbcRuntimeRetention.java; FROM='        JdbcRuntimeBindingRepository.lockPlacementDomain(connection, candidate.tenantId(), 10);\n'; TO='';;
  esac
  git checkout -q -- packages/sdk-java
  if [ -n "$F" ]; then
    FROM="$FROM" TO="$TO" perl -0 -i -pe 'BEGIN{$f=$ENV{FROM}; $t=$ENV{TO}; $f=~s/\\n/\n/g; $t=~s/\\n/\n/g} $n += s/\Q$f\E/$t/g; END{ print STDERR "replacements=$n\n" }' $F 2> $S/mutit-$M.subst
    grep -q 'replacements=1$' $S/mutit-$M.subst || { echo "$M SUBSTITUTION FAILED"; continue; }
  fi
  for DB in mysql maria; do
    [ "$DB" = mysql ] && PORT=33642 || PORT=43642
    mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-mut -Pmysql-integration -Dmysql.user=root -Dmysql.password=pr13642 \
      -Dspotbugs.skip=true -Dtest=BrokerValuesTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=JdbcRuntimeRetentionMySqlIT \
      -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/mutit_${M}_${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
      -f packages/sdk-java/runtime-broker/pom.xml verify > $S/mutit-$M-$DB.log 2>&1
    rc=$?; res=$(grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" $S/mutit-$M-$DB.log | tail -1)
    why=$(grep -m1 -E "^\[ERROR\]   JdbcRuntimeRetentionMySqlIT\.[a-zA-Z]+.*" $S/mutit-$M-$DB.log | cut -c1-170)
    echo "$M $DB rc=$rc $res $why"
  done
done
git checkout -q -- packages/sdk-java
