#!/bin/bash
# usage: build-java.sh <worktree> <tag> <db>
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f6f165f1-2767-4012-bf7c-2c22899a4751/scratchpad
WT=$SP/$1; TAG=$2; DB=$3
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A="--batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo"
cd $WT
mvn $A -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/$TAG-qwencode.log 2>&1 || echo "FAIL qwencode"
mvn $A -f packages/sdk-java/runtime-broker/pom.xml -Dgpg.skip=true install > $SP/logs/$TAG-broker.log 2>&1; echo "broker install+test rc=$?"; grep -E "Tests run: [0-9]+, Fail" $SP/logs/$TAG-broker.log | grep -v " -- in " | tail -1
docker exec pr12855-mariadb mariadb -uroot -prig12855 -e "DROP DATABASE IF EXISTS $DB"
cd packages/sdk-java/managed-agent-server
mvn $A -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:13855/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig12855 clean verify checkstyle:check > $SP/logs/$TAG-verify.log 2>&1; echo "server verify rc=$?"
grep -E "Tests run: [0-9]+, Fail|violations|BUILD" $SP/logs/$TAG-verify.log | grep -v " -- in " | tail -4
cp target/qwen-managed-agent-server-*.jar $SP/jars/$TAG-server.jar && echo "jar $TAG ok"
