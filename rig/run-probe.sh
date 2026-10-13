#!/bin/bash
# usage: run-probe.sh <label> <arm> <m2> <it-method> [extra mvn args...]
# Drops pr13974_<label>_* databases on the rig MySQL (port 13974), copies the
# probe IT into <arm>, runs it through failsafe with the arm's gate-on build
# (dist-on), its shipped build (dist) and the base build, writing evidence
# JSON to results/<label>/ and the maven log to logs/<label>.log.
set -uo pipefail
LABEL=$1; ARM=$2; M2=$3; METHOD=$4; shift 4
BASE=/Users/wenshao/git/pr13974-arms
TREE=$BASE/$ARM
MYSQL=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql
DB=pr13974_${LABEL//-/_}
for t in $($MYSQL --no-defaults -uroot -h127.0.0.1 -P13974 -N -e "SHOW DATABASES LIKE '${DB}\_%'"); do
  $MYSQL --no-defaults -uroot -h127.0.0.1 -P13974 -e "DROP DATABASE \`$t\`" || exit 2
done
cp $BASE/rig/HostedPr13974ProbeMySqlIT.java $TREE/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/
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
  -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false -Dit.test="HostedPr13974ProbeMySqlIT#$METHOD" \
  -Dnode.executable=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin/node \
  -Dqwen.cli.entry="$TREE/dist-on/cli.js" -Dqwen.cli.off="$TREE/dist/cli.js" -Dqwen.cli.base="$BASE/base/dist/cli.js" \
  -Dprobe.proxy=$BASE/rig/hold-proxy.mjs -Dprobe.storeProxy=$BASE/rig/store-proxy.mjs -Dprobe.out=$BASE/results/$LABEL \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13974/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password= "$@" test-compile failsafe:integration-test failsafe:verify > "$LOG" 2>&1
rc=$?
echo "RESULT $LABEL $METHOD rc=$rc seconds=$(( $(date +%s) - start )) $(grep -o 'Tests run: [0-9]*, Failures: [0-9]*, Errors: [0-9]*, Skipped: [0-9]*' "$LOG" | tail -1)" | tee -a "$LOG"
