#!/bin/bash
# Repeats for runs the pre-existing `Output: (empty)` shell glitch spoiled in the first batch.
cd /root/verify/pr10916
H=r3/harness/run-headless.sh
P12='LEADER-PROMPT-MARKER: delegate collecting git notes for this project.'
P1='Figure out the git remote and recent history of this project.'
for i in 2 3 4; do bash $H r3/pr s1-git-deadend r3/runs/s1-git-deadend__pr-rep$i --approval-mode yolo -p "$P1"; done
for i in 4 5 6; do bash $H r3/pr s12-stophook-r71 r3/runs/s12-stophook-r71__pr-rep$i --approval-mode yolo -p "$P12"; done
bash $H r3/mut-r71 s12-stophook-r71 r3/runs/s12-stophook-r71__mut-r71-rep2 --approval-mode yolo -p "$P12"
for i in 2 3; do bash $H r3/pr s12-stophook-r71 r3/runs/s12-stophook-r71__pr-telemetry$i --approval-mode yolo --telemetry --telemetry-target local --telemetry-outfile /root/verify/pr10916/r3/runs/s12-telemetry$i.json -p "$P12"; done
echo R3_REPS_DONE
