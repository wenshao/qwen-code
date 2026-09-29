#!/bin/bash
# usage: mutate.sh <mutant|BASE> [db] [cases...]
source <rig>/rig/env.sh
NAME=$1; DBK=${2:-mysql}; shift 2
CASES=${*:-start-retry raw-contract release-reply}
KIND=server
if [ "$NAME" != BASE ]; then
  KIND=$(node $SP/rig/mutants.cjs kind $NAME)
  BEFORE=$($SP/rig/fingerprint.sh $KIND)
  node $SP/rig/mutants.cjs apply $NAME || exit 2
  $SP/rig/rebuild.sh $KIND || { node $SP/rig/mutants.cjs restore $NAME; exit 2; }
fi
for C in $CASES; do
  LABEL=mut-$NAME-$C-$DBK${TAG:+-$TAG}
  if [ "$C" = all ]; then SEL=; else SEL=-Dqwen.fg6f.provider.case=$C; fi
  WT=wt-mut M2=m2-mut $SP/rig/it.sh $LABEL $DBK hosted-workspace-tools -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
    '-Dit.test=HostedWorkspaceToolTurnIT#providerRetriesKeepContractsAndCloseAdmissionOnMySql' $SEL > /dev/null 2>&1
  RC=$?
  L=$SP/logs/it-$LABEL.log
  AFTER=$($SP/rig/fingerprint.sh $KIND)
  WHY=$(grep -m1 -E "AssertionError|AssertionFailedError|Expecting|expected|Error: |ERR_ASSERTION|Driver output" $L | sed 's/^[[:space:]]*//' | cut -c1-260)
  sleep 2
  ORPH=$(ps -Ao pid,ppid,command | grep -F "$SP/wt-mut" | grep -v -E "grep|mysqld|mvn|maven" | wc -l | tr -d " ")
  echo "$NAME $C db=$DBK exit=$RC live=${BEFORE:-base}->${AFTER} ok=$(grep -c '^HOSTED_PROVIDER_FAULTS_OK' $L) orphans=$ORPH | $WHY" | tee -a $SP/results/mutants.txt
done
if [ "$NAME" != BASE ]; then
  node $SP/rig/mutants.cjs restore $NAME
  $SP/rig/rebuild.sh $KIND
fi
