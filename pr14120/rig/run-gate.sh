#!/bin/bash
# usage: run-gate.sh <label> <tree> <mode:root|ci|cifix> <unit:yes|no> [extra mvn -D args...]
set -u
LABEL=$1; TREE=$2; MODE=$3; UNIT=$4; shift 4
OUT=/rig/results/$LABEL; mkdir -p $OUT
NODE=$(command -v node)
URL="jdbc:mysql://pr14120-db:3306/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false"
SKIPUNIT=""; [ "$UNIT" = no ] && SKIPUNIT="-Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false"
MVN="mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-monitor-run-gates -Dnode.executable=$NODE -Dqwen.cli.entry=$TREE/dist/cli.js -Dmysql.url=$URL -Dmysql.user=root -Dmysql.password=hosted-fixture $SKIPUNIT $* ${GOALS:-clean verify checkstyle:check}"
case $MODE in
  root)
    ROOT=/sys/fs/cgroup/fg8; mkdir -p $ROOT
    cd $TREE; echo "MODE=root uid=$(id -u) cgroup=$(cat /proc/self/cgroup)" > $OUT/meta.txt
    START=$(date +%s); QWEN_MANAGED_HOOK_CGROUP_ROOT=$ROOT $MVN > $OUT/mvn.log 2>&1; RC=$?;;
  ci)
    # CI shape: sudo mkdir + chown to the job user; the job user's processes stay outside the subtree
    ROOT=/sys/fs/cgroup/fg8ci; mkdir -p $ROOT; chown -R runner:runner $ROOT; test -f $ROOT/cgroup.kill || exit 9
    cd $TREE; echo "MODE=ci uid=1001 shell-cgroup=$(cat /proc/self/cgroup)" > $OUT/meta.txt
    START=$(date +%s); setpriv --reuid=1001 --regid=1001 --init-groups env HOME=/home/runner QWEN_MANAGED_HOOK_CGROUP_ROOT=$ROOT $MVN -s /home/runner/.m2/settings.xml > $OUT/mvn.log 2>&1; RC=$?;;
  cifix)
    # candidate: same as CI, plus the Verify step first moves its own shell into a leaf of the delegated subtree
    ROOT=/sys/fs/cgroup/fg8fix; mkdir -p $ROOT/job; chown -R runner:runner $ROOT; test -f $ROOT/cgroup.kill || exit 9
    echo $$ > $ROOT/job/cgroup.procs
    cd $TREE; echo "MODE=cifix uid=1001 shell-cgroup=$(cat /proc/self/cgroup)" > $OUT/meta.txt
    START=$(date +%s); setpriv --reuid=1001 --regid=1001 --init-groups env HOME=/home/runner QWEN_MANAGED_HOOK_CGROUP_ROOT=$ROOT $MVN -s /home/runner/.m2/settings.xml > $OUT/mvn.log 2>&1; RC=$?;;
esac
END=$(date +%s)
cp -r $TREE/packages/sdk-java/managed-agent-server/target/failsafe-reports $OUT/ 2>/dev/null
sed -n "/<testcase/p" $OUT/failsafe-reports/TEST-*HostedMonitorRun*.xml 2>/dev/null | grep -o "name=\"[a-z0-9A-Z]*\"\|time=\"[0-9.]*\"" | paste - - > $OUT/cases.txt
FAILAT=$(grep -h "FG8 failed at" $TREE/packages/sdk-java/managed-agent-server/target/fg8-cases/*/driver.log 2>/dev/null | head -1 | cut -c1-160)
cp -r $TREE/packages/sdk-java/managed-agent-server/target/fg8-cases $OUT/ 2>/dev/null
echo "RESULT label=$LABEL mode=$MODE rc=$RC secs=$((END-START)) failat=[$FAILAT] $(grep -E 'Tests run:.*Fail' $OUT/mvn.log | tail -1)" | tee -a /rig/results/RESULTS.txt
chmod -R a+rX $OUT
