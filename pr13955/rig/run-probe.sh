#!/bin/bash
# usage: run-probe.sh <label> <tree> <m2> <it-method-pattern> [extra mvn args...]
# Drops pr13955_<label>_* databases on the rig MySQL (port 13955), copies the
# probe IT into <tree>, runs it through failsafe, writes evidence JSON to
# results/<label>/ and the maven log to logs/<label>.log.
set -uo pipefail
LABEL=$1; TREE=$2; M2=$3; METHOD=$4; shift 4
BASE=/Users/wenshao/git/pr13955-arms
MYSQL=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql
DB=pr13955_${LABEL//-/_}
for t in p1 p2 p3 p4 p5 p6 p7 p8; do
  $MYSQL --no-defaults -uroot -h127.0.0.1 -P13955 -e "DROP DATABASE IF EXISTS ${DB}_$t" || exit 2
done
cp $BASE/rig/HostedPr13955ProbeMySqlIT.java $TREE/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/
export JAVA_HOME=$HOME/Install/jdk21
[ -d "$JAVA_HOME/Contents/Home" ] && export JAVA_HOME=$JAVA_HOME/Contents/Home
export PATH=$JAVA_HOME/bin:$HOME/Install/maven/bin:$PATH
export TZ=UTC
mkdir -p $BASE/results/$LABEL $BASE/logs
LOG=$BASE/logs/$LABEL.log
start=$(date +%s)
cd "$TREE"
mvn -o --batch-mode --no-transfer-progress -Dmaven.repo.local=$M2 -f packages/sdk-java/managed-agent-server/pom.xml \
  -Phosted-harness-mysql -Dspotbugs.skip=true -Dcheckstyle.skip=true -Djacoco.skip=true \
  -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="HostedPr13955ProbeMySqlIT#$METHOD" \
  -Dnode.executable=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin/node \
  -Dqwen.cli.entry="$TREE/dist/cli.js" -Dprobe.proxy=$BASE/rig/hold-proxy.mjs -Dprobe.out=$BASE/results/$LABEL \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13955/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password= "$@" test-compile failsafe:integration-test failsafe:verify > "$LOG" 2>&1
rc=$?
echo "RESULT $LABEL $METHOD rc=$rc seconds=$(( $(date +%s) - start )) $(grep -o 'Tests run: [0-9]*, Failures: [0-9]*, Errors: [0-9]*, Skipped: [0-9]*' "$LOG" | tail -1)" | tee -a "$LOG"
