#!/bin/bash
# usage: run-it.sh <tree> <m2> <db-url-base> <dbname> <it-class[#method]> <log> [extra mvn args...]
set -uo pipefail
TREE=$1; M2=$2; URLBASE=$3; DB=$4; IT=$5; LOG=$6; shift 6
export JAVA_HOME=$HOME/Install/jdk21
[ -d "$JAVA_HOME/Contents/Home" ] && export JAVA_HOME=$JAVA_HOME/Contents/Home
export PATH=$JAVA_HOME/bin:$HOME/Install/maven/bin:$PATH
export TZ=UTC
cd "$TREE"
start=$(date +%s)
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$M2 -f packages/sdk-java/managed-agent-server/pom.xml \
  -Phosted-harness-mysql -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="$IT" \
  -Dnode.executable="${NODE_BIN:-/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node}" -Dqwen.cli.entry="$TREE/dist/cli.js" \
  -Dmysql.url="${URLBASE}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password="${MYSQL_PW:-probe}" "$@" verify > "$LOG" 2>&1
rc=$?
echo "RC=$rc ELAPSED=$(( $(date +%s) - start ))s" >> "$LOG"
grep -E 'Tests run:|FAIL|ERROR\]' "$LOG" | grep -v '^\[INFO\] *$' | tail -8
tail -1 "$LOG"
