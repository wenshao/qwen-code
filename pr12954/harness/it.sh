#!/bin/bash
# usage: it.sh <label> <mysql|mariadb|mysqlci> <profile> [extra maven args...]
# env: WT (default wt-pr), DBNAME (default it_<label>), M2 (default m2)
source /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad/rig/env.sh
LABEL=$1; DBKIND=$2; PROFILE=$3; shift 3
DB=${DBNAME:-it_$(echo $LABEL | tr -c 'a-zA-Z0-9\n' '_')}
case $DBKIND in
  mysql) PORT=13954; TZX=;;
  mariadb) PORT=13955; TZX=UTC;;
  mysqlci) PORT=13956; TZX=UTC;;
esac
URL="jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
cd $SP/${WT:-wt-pr}
START=$(date +%s)
env ${TZX:+TZ=$TZX} mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/${M2:-m2} -f packages/sdk-java/managed-agent-server/pom.xml -P$PROFILE \
  -Dnode.executable=$(command -v node) -Dqwen.cli.entry=$SP/${WT:-wt-pr}/dist/cli.js \
  -Dmysql.url="$URL" -Dmysql.user=root -Dmysql.password=rig12954 "$@" > $SP/logs/it-$LABEL.log 2>&1
RC=$?
echo "label=$LABEL db=$DBKIND/$DB exit=$RC elapsed=$(($(date +%s)-START))s load=$(sysctl -n vm.loadavg)"
grep -E "FG6[ABCDEF]_|^FG6F |HOSTED_[A-Z_]*_OK|Tests run:|BUILD|ERROR\]|AssertionError|expected" $SP/logs/it-$LABEL.log | cut -c1-400 | head -70
exit $RC
