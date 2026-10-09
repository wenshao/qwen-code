#!/bin/bash
# Round-2 mutants on 20bf0fcf (wt-mut). usage: mut2.sh <mutant...>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
WT=$S/wt-mut; export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
B=packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker
G=packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedRuntimeRetentionGuard.java
MVN="mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$S/m2-mut -Dspotbugs.skip=true"
cd $WT
cls() { # <log> <ClassSimpleName> -> "run/fail/err" or "absent"
  local l; l=$(grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+.* -- in .*\.$2$" "$1" | tail -1)
  [ -z "$l" ] && { echo absent; return; }
  echo "$l" | sed -E 's/.*Tests run: ([0-9]+), Failures: ([0-9]+), Errors: ([0-9]+).*/\1 run, \2 fail, \3 err/'
}
verdict() { case "$1" in absent) echo "NOT-RUN";; *" 0 fail, 0 err") echo "survived ($1)";; *) echo "KILLED ($1)";; esac; }
for M in "$@"; do
  F=; FROM=; TO=
  case $M in
    BASELINE-BRK|BASELINE-SRV) ;;
    F1r) F=$B/JdbcRuntimeRetention.java
      FROM='statement.setString(4, lastActiveAt);\n                    statement.setString(5, cursor.bindingState());\n                    statement.setString(6, lastActiveAt);'
      TO='JdbcRepositorySupport.setInstant(statement, 4, cursor.lastActiveAt());\n                    statement.setString(5, cursor.bindingState());\n                    JdbcRepositorySupport.setInstant(statement, 6, cursor.lastActiveAt());';;
    G1) F=$G; FROM='\n                || childRunUnsettled(connection, binding);'; TO=';';;
    G2) F=$G; FROM='if (parent == null || run == null) {\n                    return true;'; TO='if (parent == null || run == null) {\n                    return false;';;
    G3) F=$G; FROM='\n                        + " AND settled_at IS NOT NULL LIMIT 1",'; TO='\n                        + " LIMIT 1",';;
    G4) F=$G; FROM='" AND CAST(record_id AS BINARY(2048)) = CAST(? AS BINARY(2048))"'; TO='" AND record_id = ?"';;
    G5) F=$G; FROM='" AND CAST(tenant_id AS BINARY(2048)) = CAST(? AS BINARY(2048))"'; TO='" AND tenant_id = ?"';;
    G6) F=$G; FROM=' || !tenantId.equals(rows.getString("tenant_id"))\n                        || !sessionId.equals(rows.getString("session_id"))'; TO='';;
    *) echo "unknown $M"; continue;;
  esac
  git checkout -q -- packages/sdk-java
  if [ -n "$F" ]; then
    FROM="$FROM" TO="$TO" perl -0 -i -pe 'BEGIN{$f=$ENV{FROM}; $t=$ENV{TO}; $f=~s/\\n/\n/g; $t=~s/\\n/\n/g} $n += s/\Q$f\E/$t/g; END{ print STDERR "replacements=$n\n" }' $F 2> $S/mut2-$M.subst
    grep -q 'replacements=1$' $S/mut2-$M.subst || { echo "$M SUBSTITUTION FAILED: $(cat $S/mut2-$M.subst)"; continue; }
    git diff --stat | tail -1 > $S/mut2-$M.diffstat
  fi
  case $M in
    F1r|BASELINE-BRK)
      $MVN -f packages/sdk-java/runtime-broker/pom.xml -Dtest=JdbcRuntimeRetentionTest test > $S/mut2-$M-h2.log 2>&1
      line="$M | H2 JdbcRuntimeRetentionTest: $(verdict "$(cls $S/mut2-$M-h2.log JdbcRuntimeRetentionTest)")"
      for DB in mysql maria; do
        [ "$DB" = mysql ] && PORT=33642 || PORT=43642
        $MVN -Pmysql-integration -Dmysql.user=root -Dmysql.password=pr13642 -Dtest=BrokerValuesTest -Dsurefire.failIfNoSpecifiedTests=false \
          -Dit.test=JdbcRuntimeRetentionMySqlIT -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/mut2_${M//-/_}_${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
          -f packages/sdk-java/runtime-broker/pom.xml verify > $S/mut2-$M-$DB.log 2>&1
        line="$line | $DB IT: $(verdict "$(cls $S/mut2-$M-$DB.log JdbcRuntimeRetentionMySqlIT)")"
      done;;
    *)
      $MVN -f packages/sdk-java/managed-agent-server/pom.xml -Dtest=ManagedRuntimeRetentionGuardTest clean test > $S/mut2-$M-h2.log 2>&1
      line="$M | H2 GuardTest: $(verdict "$(cls $S/mut2-$M-h2.log ManagedRuntimeRetentionGuardTest)")"
      for DB in mysql maria; do
        [ "$DB" = mysql ] && PORT=33642 || PORT=43642
        $MVN -Pmysql-integration -Dmysql.user=root -Dmysql.password=pr13642 -Dtest=ManagedRuntimeRetentionGuardTest \
          -Dit.test='ManagedRuntimeRetentionGuardMySqlIT,ManagedRuntimeRetentionRaceMySqlIT' -Dmysql.url="jdbc:mysql://127.0.0.1:$PORT/mut2_${M//-/_}_${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
          -f packages/sdk-java/managed-agent-server/pom.xml verify > $S/mut2-$M-$DB.log 2>&1
        line="$line | $DB GuardIT: $(verdict "$(cls $S/mut2-$M-$DB.log ManagedRuntimeRetentionGuardMySqlIT)") RaceIT: $(verdict "$(cls $S/mut2-$M-$DB.log ManagedRuntimeRetentionRaceMySqlIT)")"
      done;;
  esac
  echo "$line"
done
git checkout -q -- packages/sdk-java
