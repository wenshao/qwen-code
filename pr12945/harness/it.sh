#!/bin/bash
# usage: it.sh <label> <mysql|mariadb|h2> <profile> [extra maven args...]
# env: WT (worktree dir, default wt-pr), DBNAME (default it_<label>), M2 (default m2)
SP=${SP:?set SP to the scratch directory}
LABEL=$1; DBKIND=$2; PROFILE=$3; shift 3
DB=${DBNAME:-it_$(echo $LABEL | tr -c 'a-zA-Z0-9\n' '_')}
DBARGS=()
case $DBKIND in
  mysql) PORT=13945;;
  mariadb) PORT=13948;;
  h2) PORT=;;
esac
if [ -n "$PORT" ]; then
  DBARGS=("-Dmysql.url=jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig12945)
fi
cd $SP/${WT:-wt-pr}
export JAVA_HOME=$HOME/Install/jdk21
export PATH=$HOME/Install/jdk21/bin:$HOME/Install/maven/bin:$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
START=$(date +%s)
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$SP/${M2:-m2} -f packages/sdk-java/managed-agent-server/pom.xml -P$PROFILE \
  -Dnode.executable=$(command -v node) -Dqwen.cli.entry=$SP/${WT:-wt-pr}/dist/cli.js \
  "${DBARGS[@]}" "$@" > $SP/logs/it-$LABEL.log 2>&1
RC=$?
echo "label=$LABEL db=$DBKIND/$DB exit=$RC elapsed=$(($(date +%s)-START))s load=$(sysctl -n vm.loadavg)"
grep -E "HOSTED_[A-Z_]*_OK|Tests run:|BUILD|ERROR\]|AssertionError|expected" $SP/logs/it-$LABEL.log | cut -c1-400 | head -40
exit $RC
