#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/028f1664-c9a6-47d4-91b9-cc5a71282104/scratchpad
F="-Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false"
G="-Dit.test=HostedWorkspaceToolTurnIT#cancellationRequiresPhysicalSettlementOnMySql"
$SP/rig/mutate.sh J3 prepared
$SP/rig/mutate.sh P1 cancel-reply
$SP/rig/mutate.sh W1 running,status-unavailable,cancel-reply
M2=m2-12848 WT=wt-12848 $SP/rig/it.sh merge12848-ci mysql hosted-harness-mysql clean verify checkstyle:check
(cd $SP/wt-12848 && /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server 2>&1 | tail -4)
cp $SP/wt-12848/packages/sdk-java/managed-agent-server/target/failsafe-reports/TEST-com.alibaba.qwen.code.managedagent.HostedWorkspaceToolTurnIT.xml $SP/results/xml/merge12848.xml 2>/dev/null
: > $SP/results/repeat.txt
for i in 1 2 3 4 5 6; do
  $SP/rig/it.sh rep-mysql-$i mysql hosted-workspace-tools verify $F "$G" > /dev/null 2>&1; RC=$?
  T=$(grep -o 'cancellationRequiresPhysicalSettlementOnMySql" classname="[^"]*" time="[^"]*"' $SP/wt-pr/packages/sdk-java/managed-agent-server/target/failsafe-reports/TEST-*HostedWorkspaceToolTurnIT.xml | grep -o 'time="[^"]*"')
  echo "mysql run $i exit=$RC ok=$(grep -c '^HOSTED_CANCELLATION_OK' $SP/logs/it-rep-mysql-$i.log) ledger=$(grep -c '^FG6D_LEDGER' $SP/logs/it-rep-mysql-$i.log) $T load=$(sysctl -n vm.loadavg | awk '{print $2}')" | tee -a $SP/results/repeat.txt
done
for i in 1 2 3; do
  $SP/rig/it.sh rep-mariadb-$i mariadb hosted-workspace-tools verify $F "$G" > /dev/null 2>&1; RC=$?
  T=$(grep -o 'cancellationRequiresPhysicalSettlementOnMySql" classname="[^"]*" time="[^"]*"' $SP/wt-pr/packages/sdk-java/managed-agent-server/target/failsafe-reports/TEST-*HostedWorkspaceToolTurnIT.xml | grep -o 'time="[^"]*"')
  echo "mariadb run $i exit=$RC ok=$(grep -c '^HOSTED_CANCELLATION_OK' $SP/logs/it-rep-mariadb-$i.log) ledger=$(grep -c '^FG6D_LEDGER' $SP/logs/it-rep-mariadb-$i.log) $T load=$(sysctl -n vm.loadavg | awk '{print $2}')" | tee -a $SP/results/repeat.txt
done
$SP/rig/it.sh rep-mariadb-class210 mariadb hosted-workspace-tools verify $F > /dev/null 2>&1; echo "mariadb class 210s-profile exit=$? $(grep -E "Tests run:.*HostedWorkspaceToolTurnIT" $SP/logs/it-rep-mariadb-class210.log | cut -c1-120)" | tee -a $SP/results/repeat.txt
echo CHAIN2_DONE
