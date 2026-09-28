#!/bin/bash
# Round 4 (mine): PR head a7c0a391 as-is (Java unchanged since 678420df), fresh MySQL schema o2j.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894
export DB=o2j HARNESS_WT=$PR
LOG=$R/out/r5-a7c0a391.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|range|reload|status after|hold|crash|load|harness|journal|run|total|broker\] POST /executions/[0-9a-f]+:(start|acknowledge))|^\[[0-9a-zA-Z,]|^\[  " | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-260 | tee -a $LOG; }
cd $R
PUB_PORT=18895 $R/up.sh pr6 $PR | tee -a $LOG
say "## M: Hosted Shell preview (a7c0a391 stderr block)"
SCRIPT=s9-preview.ts run "M preview matrix" LABEL=r5 ST_BASE=40 CASES="$(cat $R/r5-cases.json)"
say "## A: regression"
for i in 1 2; do run "A echo stdout+stderr $i" TAG=r5e$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "A 100MiB+5MiB exit 7" TAG=r5m100 ST=s04 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
SCRIPT=s1-big-shell.ts run "A 1GiB" TAG=r5g1 ST=s11 SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000
SCRIPT=s7-concurrent.ts run "A 4 sessions x 256 MiB concurrently" TAG=r5k N=4 ST_BASE=60 SO=268435456 SE=1048576 CAPTURE=600000000
run "A crash after receipt commit" TAG=r5hk ST=s05 HOLD_KILL='/receipts/commit'
run "A segment request lost once" TAG=r5f1 ST=s06 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "A admission prepare reply lost once" TAG=r5f5 ST=s07 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]'
run "A control chars + crash after receipt" TAG=r5f9 ST=s08 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-o2j.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o2j.log)"
say "## G: deferred activation gate (expected to remain)"
run "G crash after admission prepare" TAG=r5g ST=s09 HOLD_KILL='/admissions/prepare'
say "## R: real model qwen3.8-max"
DB=o2j LABEL=r5-real-3000 TRIALS=4 ST_BASE=70 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|model-call\|summary" | cut -c1-240 | tee -a $LOG
DB=o2j LABEL=r5-real-30000 TRIALS=2 ST_BASE=74 N=30000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|model-call\|summary" | cut -c1-240 | tee -a $LOG
say "## D: author's file-tool driver x3"
BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh pr6 $PR | tee -a $LOG
for p in "s30,s31" "s32,s33" "s34,s35"; do say "load: $(uptime | sed 's/.*averages: //')"; BROKER_TOKEN=hosted-tools-broker-token LABEL=r5-files-${p%,*} $TSX $R/s6-author-driver.mjs $p 2>&1 | tail -1 | cut -c1-140 | tee -a $LOG; done
say "## done"
