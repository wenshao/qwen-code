#!/bin/bash
# usage: repeat.sh <db> <n> -- run the provider method n times on wt-pr
SP=<rig>
DBK=$1; N=$2
for i in $(seq 1 $N); do
  $SP/rig/it.sh rep-$DBK-$i $DBK hosted-workspace-tools -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
    '-Dit.test=HostedWorkspaceToolTurnIT#providerRetriesKeepContractsAndCloseAdmissionOnMySql' > /dev/null 2>&1
  RC=$?
  L=$SP/logs/it-rep-$DBK-$i.log
  T=$(grep -o "Time elapsed: [0-9.]* s -- in com.alibaba.qwen.code.managedagent.HostedWorkspaceToolTurnIT" $L | awk '{print $3}')
  echo "rep $DBK $i exit=$RC junit=${T}s db=$(grep -m1 -o 'FG6F_DATABASE .*' $L) ledger=$(grep -c '^FG6F_PROVIDER_LEDGER' $L) load=$(sysctl -n vm.loadavg)" | tee -a $SP/results/repeats.txt
done
