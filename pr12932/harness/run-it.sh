#!/bin/bash
# usage: run-it.sh <wt> <tag>  -> runs mysql-integration verify on MariaDB then MySQL
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ecedb9b6-9fa2-400f-875c-ddbcceef89e3/scratchpad
WT=$SP/$1; TAG=$2; M2=${3:-$SP/m2}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
cd $WT/packages/sdk-java/managed-agent-server || exit 1
for spec in mariadb:33296:v12932-mariadb mysql:33294:v12932-mysql84; do
  IFS=: read eng port ctr <<<"$spec"
  DB=it_${TAG//-/_}_${eng}_$(date +%s)
  mvn --batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$M2 -Pmysql-integration \
    "-Dmysql.url=jdbc:mysql://127.0.0.1:$port/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
    -Dmysql.user=root -Dmysql.password=v12932 -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
    verify > $SP/logs/$TAG-it-$eng.log 2>&1
  echo "$eng rc=$? db=$DB"; grep -E "Tests run:.*in com|Tests run:.*Fail.*Skipped: [0-9]+$|BUILD|FAIL" $SP/logs/$TAG-it-$eng.log | tail -6
done
echo IT_DONE
