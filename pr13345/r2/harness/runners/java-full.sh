#!/bin/bash
# usage: java-full.sh <tree dir> <tag> <db> [mvn wrapper]
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
T=$1; TAG=$2; DB=$3; MVN=${4:-$S/mvn.sh}
[ -d "$T" ] && [ -n "$TAG" ] && [ -n "$DB" ] || { echo usage; exit 2; }
cd $T/packages/sdk-java/managed-agent-server || exit 2
$MVN -o clean verify checkstyle:check -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13345/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=rig13345 -Duser.timezone=UTC > $S/r2/logs/java-full-$TAG.log 2>&1
echo "exit=$?" >> $S/r2/logs/java-full-$TAG.log
