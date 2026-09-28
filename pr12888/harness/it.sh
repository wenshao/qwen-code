#!/bin/bash
# usage: it.sh <label> <mysql|mariadb|mysqlci> <profile> [extra maven args...]
# env: WT (worktree, default wt-pr), DBUSER/DBPASS (default root/rig12888), DBNAME (default it_<label>)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/83b94b04-5287-4c5b-88f4-0baa57846046/scratchpad
LABEL=$1; DBKIND=$2; PROFILE=$3; shift 3
DB=${DBNAME:-it_$(echo $LABEL | tr -c 'a-zA-Z0-9\n' '_')}
case $DBKIND in
  mysql) PORT=13888;;
  mariadb) PORT=13889;;
  mysqlci) PORT=13890;;
esac
URL="jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
cd $SP/${WT:-wt-pr}
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
START=$(date +%s)
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/m2 -f packages/sdk-java/managed-agent-server/pom.xml -P$PROFILE \
  -Dnode.executable=$(command -v node) -Dqwen.cli.entry=$SP/${WT:-wt-pr}/dist/cli.js \
  -Dmysql.url="$URL" -Dmysql.user=${DBUSER:-root} -Dmysql.password=${DBPASS:-rig12888} "$@" > $SP/logs/it-$LABEL.log 2>&1
RC=$?
echo "label=$LABEL db=$DBKIND/$DB exit=$RC elapsed=$(($(date +%s)-START))s"
grep -E "FG6[AB]|HOSTED_|PROBE|Tests run:.*IT|Tests run: [0-9]+, F.*$|BUILD|ERROR\]" $SP/logs/it-$LABEL.log | cut -c1-300 | head -50
exit $RC
