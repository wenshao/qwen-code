#!/bin/bash
SP=<rig>
$SP/rig/probe-run.sh fields all RIG_ALL_FIELDS=1
$SP/rig/probe-run.sh reqloss release-reply RIG_RELEASE_REQUEST_LOSS=1
$SP/rig/probe-run.sh count all RIG_RELEASE_COUNT=1
$SP/rig/probe-run.sh count-reqloss release-reply RIG_RELEASE_COUNT=1 RIG_RELEASE_REQUEST_LOSS=1
node $SP/rig/mutants.cjs apply W5 wt-probe
$SP/rig/probe-run.sh W5-gate all RIG_NONE=1
$SP/rig/probe-run.sh W5-count release-reply RIG_RELEASE_COUNT=1
$SP/rig/probe-run.sh W5-reqloss release-reply RIG_RELEASE_REQUEST_LOSS=1
node $SP/rig/mutants.cjs restore W5 wt-probe
$SP/rig/probe-run.sh after-restore all RIG_RELEASE_COUNT=1
echo PROBE_CHAIN_DONE
