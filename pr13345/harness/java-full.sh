#!/bin/bash
# usage: java-full.sh <arm> <db>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
ARM=$1; DB=$2
[ -n "$ARM" ] && [ -n "$DB" ] || { echo "usage"; exit 2; }
cd $S/wt-$ARM/packages/sdk-java/managed-agent-server || exit 2
$S/mvn.sh -o clean verify checkstyle:check -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13345/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=rig13345 -Duser.timezone=UTC > $S/logs/java-full-$ARM.log 2>&1
echo "exit=$?" >> $S/logs/java-full-$ARM.log
