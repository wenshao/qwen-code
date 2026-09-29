#!/bin/bash
SP=<rig>
M2P=m2-probe $SP/rig/probe-run.sh lease-base start-retry RIG_RETRY_AFTER_MS=33000
node $SP/rig/mutants.cjs apply J6 wt-probe
$SP/rig/rebuild.sh broker wt-probe m2-probe && echo "J6 jar $($SP/rig/fingerprint.sh broker wt-probe m2-probe)" >> $SP/results/probes.txt
M2P=m2-probe $SP/rig/probe-run.sh lease-J6-late start-retry RIG_RETRY_AFTER_MS=33000
M2P=m2-probe $SP/rig/probe-run.sh lease-J6-early start-retry RIG_NONE=1
node $SP/rig/mutants.cjs restore J6 wt-probe
$SP/rig/rebuild.sh broker wt-probe m2-probe && echo "restored jar $($SP/rig/fingerprint.sh broker wt-probe m2-probe)" >> $SP/results/probes.txt
echo PROBE_LEASE_DONE
