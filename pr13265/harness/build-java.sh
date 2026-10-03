#!/bin/bash
# usage: build-java.sh <worktree-name> <tag> <mode: verify|package> [db]
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad
WT=$SP/$1; TAG=$2; MODE=$3; DB=${4:-mat_$TAG}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
A=(--batch-mode --no-transfer-progress -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo)
cd "$WT" || exit 2
if [ "${SKIP_DEPS:-0}" != 1 ]; then
  mvn "${A[@]}" -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $SP/logs/$TAG-qwencode.log 2>&1; echo "qwencode rc=$?"
  mvn "${A[@]}" -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install > $SP/logs/$TAG-broker.log 2>&1; echo "broker rc=$?"
fi
cd packages/sdk-java/managed-agent-server
if [ "$MODE" = verify ]; then
  docker --context colima exec pr13265-mariadb mariadb -uroot -prig13265 -e "DROP DATABASE IF EXISTS $DB"
  mvn "${A[@]}" -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:13265/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13265 -Duser.timezone=UTC clean verify checkstyle:check > $SP/logs/$TAG-verify.log 2>&1; echo "server verify rc=$?"
  grep -E "Tests run: [0-9]+, Fail|violations|BUILD" $SP/logs/$TAG-verify.log | grep -v " -- in " | tail -5
else
  mvn "${A[@]}" -DskipTests -Dspotbugs.skip=true clean package > $SP/logs/$TAG-package.log 2>&1; echo "server package rc=$?"
fi
cp target/qwen-managed-agent-server-0.1.0-alpha.jar $SP/jars/$TAG-server.jar && echo "jar $TAG ok $(shasum -a 256 $SP/jars/$TAG-server.jar | cut -c1-16)"
