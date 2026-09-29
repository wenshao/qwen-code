#!/bin/bash
source <rig>/rig/env.sh
# B: all other Hosted IT classes/methods with J5 (hosted-harness-mysql profile, provider method excluded)
node $SP/rig/mutants.cjs apply J5 wt-mut > /dev/null && $SP/rig/rebuild.sh broker wt-mut m2-mut && echo "J5 jar $($SP/rig/fingerprint.sh broker)" >> $SP/results/j5-wide.txt
WT=wt-mut M2=m2-mut $SP/rig/it.sh j5-hosted mysql hosted-harness-mysql -Dtest=NoUnitTests -Dsurefire.failIfNoSpecifiedTests=false '-Dit.test=Hosted*IT,!HostedWorkspaceToolTurnIT#providerRetriesKeepContractsAndCloseAdmissionOnMySql' > /dev/null 2>&1
echo "J5 other-hosted rc=$? $(grep -E 'Tests run:.*Skipped: [0-9]+$' $SP/logs/it-j5-hosted.log | tail -1) $(grep -c '<<< FAIL' $SP/logs/it-j5-hosted.log) failing-lines" >> $SP/results/j5-wide.txt
node $SP/rig/mutants.cjs restore J5 wt-mut > /dev/null && $SP/rig/rebuild.sh broker wt-mut m2-mut && echo "restored jar $($SP/rig/fingerprint.sh broker)" >> $SP/results/j5-wide.txt
echo J5B_DONE >> $SP/results/j5-wide.txt
