#!/bin/bash
# usage: probe.sh <mode> <label> [extra maven args]   (mode: default|race|late)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9a095a26-d8c9-4266-9a4d-4dda027df21c/scratchpad
MODE=$1; LABEL=$2; shift 2
FG6E_PROBE=$MODE WT=${WT:-wt-probe} $SP/rig/it.sh probe-$LABEL ${DBK:-mysql} hosted-workspace-tools verify -Dcheckstyle.skip=true -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false \
  '-Dit.test=HostedWorkspaceToolTurnIT#disconnectedObserversResumeWithoutReplayingTheToolOnMySql' "$@" > /dev/null 2>&1
RC=$?
L=$SP/logs/it-probe-$LABEL.log
echo "$LABEL mode=$MODE exit=$RC ok=$(grep -c '^HOSTED_SSE_GAP_OK' $L) $(grep -h -o -E 'PROBE_(IDS|RACE)[^$]*' $L | tr '\n' ' ' | cut -c1-200) | $(node $SP/rig/why.cjs $L)" | tee -a $SP/results/probes.txt
grep -h '^PROBE_HUB' $L | sed "s/^/   /" | tee -a $SP/results/probes.txt
