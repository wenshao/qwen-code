#!/bin/bash
# Repeat the new recovery-window assertion: H2 x10, MySQL x10, MySQL without fractional seconds x10.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e298c115-72d4-4be7-89e8-481e9f912a53/scratchpad
cd /Users/wenshao/git/qwen-code-pr13114-mut/packages/sdk-java/managed-agent-server
OUT=$SP/logs/flaky-j4.log; : > $OUT
one() { # label, extra mvn args...
  local label=$1; shift
  $SP/rig/mvn.sh -o "$@" > $SP/logs/flaky-j4-last.log 2>&1; local rc=$?
  local line=$(grep -E "Tests run: [0-9]+, F.*Skipped: [0-9]+$" $SP/logs/flaky-j4-last.log | tail -1)
  echo "$label rc=$rc $line load=$(uptime | sed 's/.*averages: //')" >> $OUT
  [ $rc -ne 0 ] && cp $SP/logs/flaky-j4-last.log $SP/logs/flaky-j4-fail-$label-$(date +%s).log
}
for i in $(seq 1 10); do one "h2-$i" -Dtest='ToolPublicationStoreTest#recoversExpiredCandidatesWithoutChangingBytesQuotaOrOriginalDeadline' -Dsurefire.failIfNoSpecifiedTests=false test; done
for i in $(seq 1 10); do one "mysql-$i" -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:13894/mysql?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig12894 -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false '-Dit.test=ToolPublicationRecoveryMySqlIT#recoversExpiredCandidatesWithoutChangingBytesQuotaOrOriginalDeadline' verify; done
for i in $(seq 1 10); do one "mysql-nofrac-$i" -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:13894/mysql?allowPublicKeyRetrieval=true&useSSL=false&sendFractionalSeconds=false" -Dmysql.user=root -Dmysql.password=rig12894 -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false '-Dit.test=ToolPublicationRecoveryMySqlIT#recoversExpiredCandidatesWithoutChangingBytesQuotaOrOriginalDeadline' verify; done
echo "## done $(date +%T)" >> $OUT
