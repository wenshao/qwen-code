#!/bin/bash
# usage: ab-hook.sh <arm> <n>  -- one run of the hook-admission MySQL IT on
# MariaDB 10.11 (colima pr13336), in the arm's worktree.
set -u
arm=$1; n=$2
R=/Users/wenshao/git/pr13336-rig
WT=/Users/wenshao/git/pr13336-$arm
[ "$arm" = head ] && WT=/Users/wenshao/git/pr13336-mut
cd $WT/packages/sdk-java/managed-agent-server
log=$R/logs/ab-hook-$arm-$n.log
TZ=UTC $R/mvn.sh -o --batch-mode --no-transfer-progress -Pmysql-integration \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33337/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=p13336 -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false \
  "-Dit.test=ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql" \
  -Dcheckstyle.skip -Dspotbugs.skip verify > $log 2>&1
code=$?
t=$(grep -oE "Time elapsed: [0-9.]+ s" $log | tail -1)
h=$(grep -oE "Hook admission at .*" $log | tail -1)
printf 'AB\t%s\t%s\texit=%s\t%s\t%s\n' "$arm" "$n" "$code" "$t" "$h" | tee -a $R/results/${AB_OUT:-ab-hook.tsv}
