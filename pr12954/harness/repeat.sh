#!/bin/bash
# usage: repeat.sh <db> <n> [tag]  -- repeat the unmodified FG6f gate on wt-pr
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad
DB=$1; N=$2; TAG=${3:-rep}
for i in $(seq 1 $N); do
  LABEL=$TAG-$DB-$i
  $SP/rig/it.sh $LABEL $DB hosted-workspace-tools verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false '-Dit.test=HostedWorkspaceToolTurnIT#shellOutputFailuresNeverReplayEffectsOnMySql' > /dev/null 2>&1
  RC=$?
  L=$SP/logs/it-$LABEL.log
  T=$(grep -o "Time elapsed: [0-9.]* s -- in com.alibaba.qwen.code.managedagent.HostedWorkspaceToolTurnIT" $L | grep -o "[0-9.]* s")
  sleep 2
  SHELLS=$(ps -Ao command | grep -F "shell.pid" | grep -v grep | wc -l | tr -d " ")
  echo "$LABEL exit=$RC ok=$(grep -c '^HOSTED_SHELL_OUTPUT_FAULTS_OK' $L) ledger=$(grep -c '^FG6F_LEDGER' $L) time=$T load=$(sysctl -n vm.loadavg | awk '{print $2}') shells=$SHELLS" | tee -a $SP/results/repeats.txt
done
