#!/bin/bash
# usage: probe-run.sh <label> <case|all> [ENV=VAL ...]  (runs in wt-probe)
SP=<rig>
LABEL=$1; C=$2; shift 2
if [ "$C" = all ]; then SEL=; else SEL=-Dqwen.fg6f.provider.case=$C; fi
env "$@" WT=wt-probe M2=${M2P:-m2} $SP/rig/it.sh probe-$LABEL mysql hosted-workspace-tools -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
  '-Dit.test=HostedWorkspaceToolTurnIT#providerRetriesKeepContractsAndCloseAdmissionOnMySql' $SEL > /dev/null 2>&1
RC=$?
L=$SP/logs/it-probe-$LABEL.log
echo "probe $LABEL case=$C env=[$*] exit=$RC ok=$(grep -c '^HOSTED_PROVIDER_FAULTS_OK' $L)" | tee -a $SP/results/probes.txt
grep -E "^RIG_|as=|worker closures|closure before|Expecting|but was|expected:" $L | sort -u | cut -c1-240 | tee -a $SP/results/probes.txt | head -40
