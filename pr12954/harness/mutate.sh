#!/bin/bash
# usage: mutate.sh <mutant|BASE> [db] [cases...]
source /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad/rig/env.sh
NAME=$1; DBK=${2:-mysql}; shift 2
CASES=${*:-publisher-kill worker-kill receipt-failure receipt-reply}
if [ "$NAME" != BASE ]; then
  KIND=$(node $SP/rig/mutants.cjs kind $NAME)
  node $SP/rig/mutants.cjs apply $NAME || exit 2
  $SP/rig/rebuild.sh $KIND || { node $SP/rig/mutants.cjs restore $NAME; exit 2; }
  case $KIND in
    ts) HITS=$(grep -rl "RIG_MUTANT_$NAME" $SP/wt-mut/dist | wc -l | tr -d ' ');;
    broker) HITS=$(unzip -p $SP/m2-mut/com/alibaba/qwen-managed-runtime-broker/0.1.0-alpha/qwen-managed-runtime-broker-0.1.0-alpha.jar 2>/dev/null | grep -ac "RIG_MUTANT_$NAME");;
    store) HITS=pending;;
  esac
fi
for C in $CASES; do
  LABEL=mut-$NAME-$C-$DBK${TAG:+-$TAG}
  WT=wt-mut M2=m2-mut $SP/rig/it.sh $LABEL $DBK hosted-workspace-tools verify -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
    '-Dit.test=HostedWorkspaceToolTurnIT#shellOutputFailuresNeverReplayEffectsOnMySql' -Dqwen.fg6f.case=$C > /dev/null 2>&1
  RC=$?
  L=$SP/logs/it-$LABEL.log
  [ "$KIND" = store ] && HITS=$(grep -c "noRollbackFor" $SP/wt-mut/packages/sdk-java/managed-agent-server/target/classes/com/alibaba/qwen/code/managedagent/store/ManagedSessionStore.class)
  WHY=$(grep -m1 -E "AssertionError|AssertionFailedError|Expecting|expected:|Error: |FG6F_LEDGER" $L | sed 's/^[[:space:]]*//' | cut -c1-230)
  sleep 2
  ORPH=$(ps -Ao pid,ppid,command | grep -F "$SP/wt-mut" | grep -v -E "grep|mysqld" | wc -l | tr -d " ")
  SHELLS=$(ps -Ao command | grep -F "shell.pid" | grep -v grep | wc -l | tr -d " ")
  echo "$NAME $C db=$DBK exit=$RC hits=$HITS ok=$(grep -c '^HOSTED_SHELL_OUTPUT_FAULTS_OK' $L) orphans=$ORPH shells=$SHELLS | $WHY" | tee -a $SP/results/mutants.txt
done
if [ "$NAME" != BASE ]; then
  node $SP/rig/mutants.cjs restore $NAME
  $SP/rig/rebuild.sh $KIND
fi
