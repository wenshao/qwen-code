#!/bin/bash
# usage: it.sh <label> <mysql|mariadb> <profile> [extra maven args...]
# env: WT (worktree dir, default wt-pr), DBNAME (default it_<label>), M2 (default m2)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9a095a26-d8c9-4266-9a4d-4dda027df21c/scratchpad
LABEL=$1; DBKIND=$2; PROFILE=$3; shift 3
DB=${DBNAME:-it_$(echo $LABEL | tr -c 'a-zA-Z0-9\n' '_')}
case $DBKIND in
  mysql) PORT=13942;;
  mariadb) PORT=13943;;
esac
URL="jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
cd $SP/${WT:-wt-pr}
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
START=$(date +%s)
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/${M2:-m2} -f packages/sdk-java/managed-agent-server/pom.xml -P$PROFILE \
  -Dnode.executable=$(command -v node) -Dqwen.cli.entry=$SP/${WT:-wt-pr}/dist/cli.js \
  -Dmysql.url="$URL" -Dmysql.user=root -Dmysql.password=rig12942 "$@" > $SP/logs/it-$LABEL.log 2>&1
RC=$?
echo "label=$LABEL db=$DBKIND/$DB exit=$RC elapsed=$(($(date +%s)-START))s load=$(sysctl -n vm.loadavg)"
grep -E "FG6[ABCDE]_|HOSTED_[A-Z_]*_OK|PROBE|Tests run:|BUILD|ERROR\]|AssertionError|expected" $SP/logs/it-$LABEL.log | cut -c1-400 | head -70
exit $RC
