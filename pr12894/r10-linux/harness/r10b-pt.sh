#!/bin/bash
# r10 rerun: P (preview matrix) and T (UTF-8 tail fixtures) after fixture path fix.
R=$(cd $(dirname $0); pwd); TSX=/root/git/qwen-code-c2/node_modules/.bin/tsx
export DB=o2r11 HARNESS_WT=/root/git/qwen-code-c2 ROOTS=$R/roots-r11 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r10b-pt.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s9-preview.ts} 2>&1 | grep -E "^\[[0-9a-zA-Z,]|^\[  " | cut -c1-300 | tee -a $LOG; }
cd $R
run "P O2 path" LABEL=r10o2 ST_BASE=21 CASES="$(cat $R/r7-cases.json)"
run "P local path" LOCAL=1 LABEL=r10l2 ST_BASE=35 CASES="$(cat $R/r7-cases.json)"
run "T O2 path" LABEL=r10t-o2 ST_BASE=49 CASES="$(cat $R/r8-tail-cases.json)"
run "T local path" LOCAL=1 LABEL=r10t-l2 ST_BASE=59 CASES="$(cat $R/r8-tail-cases.json)"
say "## pt done"
