#!/bin/bash
# usage: o4gate.sh <worktree> <label> <profile: o4-mysql-gates|o4-oss-gates|mysql-integration> [extra mvn args...]
# Runs the runbook's two-stage entry (Maven profile && source-derived report check) against the gate mysqld 33090.
W=$1; L=$2; P=$3; shift 3
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9d84bca0-c4ea-4895-80e3-553468b6983a/scratchpad; M=$S/rig/mvn.sh
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $W || exit 2
LOG=$S/logs/gate-$L.log
echo "== $L $P $(git rev-parse HEAD) start $(date '+%F %T %Z') TZ=$(date +%Z)" | tee $LOG
export QWEN_O4_MYSQL_PASSWORD=pw13090
case $P in
  o4-mysql-gates) FAM=o4-mysql; ARGS=(-Po4-mysql-gates "-Dqwen.o4.mysql.url=jdbc:mysql://127.0.0.1:33090/qwen_o4_gate?allowPublicKeyRetrieval=true&useSSL=false" -Dqwen.o4.mysql.user=root);;
  o4-oss-gates) FAM=o4-oss; ARGS=(-Po4-oss-gates "-Dqwen.o4.mysql.url=jdbc:mysql://127.0.0.1:33090/qwen_o4_gate?allowPublicKeyRetrieval=true&useSSL=false" -Dqwen.o4.mysql.user=root -Dqwen.o4.oss.region=cn-hangzhou "-Dqwen.o4.oss.test-bucket=$(cat $S/realoss/bucket.txt)");;
  mysql-integration) FAM=non-hosted; ARGS=(-Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33090/managed_agent_test_$L?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=pw13090);;
esac
T0=$(date +%s)
$M -o -f packages/sdk-java/managed-agent-server/pom.xml "${ARGS[@]}" "$@" clean verify checkstyle:check >> $LOG 2>&1; MRC=$?
echo "== maven exit=$MRC after $(( $(date +%s) - T0 ))s" | tee -a $LOG
if [ "$FAM" = non-hosted ]; then $NODE scripts/check-failsafe-reports.js non-hosted packages/sdk-java/managed-agent-server >> $LOG 2>&1; else $NODE scripts/check-failsafe-reports.js $FAM packages/sdk-java/managed-agent-server >> $LOG 2>&1; fi; CRC=$?
echo "== checker exit=$CRC; two-stage result: $([ $MRC = 0 ] && [ $CRC = 0 ] && echo PASS || echo FAIL)" | tee -a $LOG
grep -E "Tests run:|FAIL|ERROR\]|violation|::error" $LOG | grep -v "^\[INFO\] Tests run:.*in com" | tail -12
