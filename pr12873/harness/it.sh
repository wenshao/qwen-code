#!/bin/bash
# usage: it.sh <label> <mysql|mariadb> <profile> [extra maven args...]
SP=$RIG
LABEL=$1; DBKIND=$2; PROFILE=$3; shift 3
DB=it_$(echo $LABEL | tr -c 'a-zA-Z0-9\n' '_')
case $DBKIND in
  mysql) PORT=13873;;
  mariadb) PORT=13874;;
esac
URL="jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
cd $SP/wt-pr
export JAVA_HOME=$JAVA21_HOME
export PATH=$JAVA21_HOME/bin:$NODE22_BIN:$PATH
START=$(date +%s)
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/m2 -f packages/sdk-java/managed-agent-server/pom.xml -P$PROFILE   -Dnode.executable=$(command -v node) -Dqwen.cli.entry=$SP/wt-pr/dist/cli.js   -Dmysql.url="$URL" -Dmysql.user=root -Dmysql.password=rig12873 "$@" > $SP/logs/it-$LABEL.log 2>&1
RC=$?
echo "label=$LABEL db=$DBKIND/$DB exit=$RC elapsed=$(($(date +%s)-START))s"
grep -E "FG6A|HOSTED_|PROBE |PROBE_FAIL|Tests run:.*IT|Tests run: [0-9]+, F.*$|BUILD|ERROR\]" $SP/logs/it-$LABEL.log | cut -c1-300 | head -40
exit $RC
