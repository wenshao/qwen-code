#!/bin/bash
# usage: lat.sh <label> <mysql|mariadb|h2> [extra maven args]  -- runs only the latency IT method
# env: WT (default wt-pr), UNIT=1 to also run surefire unit tests
SP=${SP:?set SP to the scratch directory}
LABEL=$1; DBK=$2; shift 2
WT=${WT:-wt-pr}
SKIP=(-Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false)
[ "$UNIT" = 1 ] && SKIP=()
R=$SP/$WT/packages/sdk-java/managed-agent-server/target/hosted-latency-baseline.json
rm -f "$R"
WT=$WT $SP/rig/it.sh lat-$LABEL $DBK hosted-workspace-tools "${SKIP[@]}" \
  '-Dit.test=HostedWorkspaceToolTurnIT#recordsLatencyWithDelayedRuntimeProvisioning' verify checkstyle:check "$@" > $SP/logs/lat-$LABEL.summary 2>&1
RC=$?
head -1 $SP/logs/lat-$LABEL.summary
if [ -s "$R" ]; then cp "$R" $SP/results/report-$LABEL.json; node -e '
const r=require(process.argv[1]);const f=(x)=>x==null?"-":Math.round(x);
for(const s of r.samples)console.log(`  ${s.scenario.padEnd(7)} warm=${f(s.warmRequestedMs)} text=${f(s.modelRounds[0].firstTextMs)} visible=${f(s.firstVisibleTextMs)} complete=${f(s.turnCompleteMs)} ready=${f(s.runtimeReadyMs)} acquire=${f(s.acquireMs)} exec=${f(s.executionStartMs)} wait=${f(s.toolWaitMs)} store=${s.storeRequests} db="${r.environment.database}"`);
for(const c of r.comparison)console.log(`  delta ${c.scenario.padEnd(7)} text=${f(c.firstModelTextDeltaMs)} visible=${f(c.firstVisibleTextDeltaMs)} complete=${f(c.turnCompleteDeltaMs)} wait=${f(c.toolWaitDeltaMs)} store=${c.storeRequestsDelta}`);' $SP/results/report-$LABEL.json
else echo "  (no report)"; grep -E "AssertionError|Error:|assert|expected|HOSTED_" $SP/logs/it-lat-$LABEL.log | grep -v "^\[INFO\]" | cut -c1-300 | head -12; fi
exit $RC
