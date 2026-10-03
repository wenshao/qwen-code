#!/bin/bash
# usage: it-one.sh <wt> <db> <ItClass#method>
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:~/Install/maven/bin:$PATH
cd $SP/$1/packages/sdk-java/managed-agent-server || exit 2
docker --context colima exec pr13265-mariadb mariadb -uroot -prig13265 -e "DROP DATABASE IF EXISTS $2"
mvn --batch-mode --no-transfer-progress -o -s $SP/m2settings.xml -Dmaven.repo.local=$SP/m2repo -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13265/$2?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=rig13265 -Duser.timezone=UTC -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false "-Dit.test=$3" verify > $SP/logs/it-$1-$2.log 2>&1
echo "$1 rc=$? $(grep -E 'Tests run: [0-9]+, Failures' $SP/logs/it-$1-$2.log | grep -v ' -- in ' | tail -1)"
