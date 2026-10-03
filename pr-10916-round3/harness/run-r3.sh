#!/bin/bash
# Round 3 E2E batch: every run is real `qwen -p --approval-mode yolo` against the scripted fake model.
cd /root/verify/pr10916
H=r3/harness/run-headless.sh
declare -A P=(
 [s12-stophook-r71]='LEADER-PROMPT-MARKER: delegate collecting git notes for this project.'
 [s1-git-deadend]='Figure out the git remote and recent history of this project.'
 [s3b-deny-rule]='Review this project and tell me whether its scripts work.'
 [s4-edit-retry]='Make node check.js pass.'
 [s8-probes]='Review my uncommitted changes.'
 [s9-mcp-distinct]='Check the orders, inventory and checkout endpoints through the upstream gateway.'
 [s9-mcp-same]='Check the orders, inventory and checkout endpoints through the upstream gateway.'
 [s10-timeouts]="Run the project's build, tests and audit and summarize."
 [s13-bg-drain-r112]='LEADER-PROMPT-MARKER: check git state in the background.'
)
run(){ arm=$1; sc=$2; tag=$3; shift 3; bash $H r3/$arm $sc r3/runs/${sc}__$tag --approval-mode yolo "$@" -p "${P[$sc]}"; }
# R7-1 at the new head
for i in 1 2 3; do run pr s12-stophook-r71 pr-rep$i; done
run main s12-stophook-r71 main
run mut-r71 s12-stophook-r71 mut-r71
run pr s12-stophook-r71 pr-telemetry --telemetry --telemetry-target local --telemetry-outfile /root/verify/pr10916/r3/runs/s12-telemetry.json
# closed items and positive controls, re-run at the new head
for sc in s1-git-deadend s9-mcp-distinct s9-mcp-same s13-bg-drain-r112; do for a in pr main; do run $a $sc $a; done; done
# round-1 item 2 (still open)
for sc in s3b-deny-rule s8-probes s4-edit-retry s10-timeouts; do for a in pr main; do run $a $sc $a; done; done
echo R3_E2E_DONE
