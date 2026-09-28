#!/bin/bash
# Round 6: PR head b0b1f51e (02ce0a62 merge of main with #12848 + raw Hosted preview), fresh MySQL schema o2l.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894
export DB=o2l HARNESS_WT=$PR
LOG=$R/out/r6-b0b1f51e.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|range|reload|status after|second turn|hold|crash|load|harness|journal|run|total|broker\] POST /executions/[0-9a-f]+:(start|acknowledge))|^\[[0-9a-zA-Z,]|^\[  " | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-260 | tee -a $LOG; }
cd $R
PUB_PORT=18895 $R/up.sh pr8 $PR | tee -a $LOG
say "## A: O2 publication path (captureBytes set)"
for i in 1 2; do run "A echo stdout+stderr $i" TAG=r6e$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "A 100MiB+5MiB exit 7" TAG=r6m100 ST=s03 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
SCRIPT=s1-big-shell.ts run "A 1GiB" TAG=r6g1 ST=s04 SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000
run "A crash after receipt commit" TAG=r6hk ST=s05 HOLD_KILL='/receipts/commit'
run "A segment request lost once" TAG=r6f1 ST=s06 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "A admission prepare reply lost once" TAG=r6f5 ST=s07 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]'
run "A control chars + crash after receipt" TAG=r6f9 ST=s08 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
run "A reload, then a second Shell turn" TAG=r6rl ST=s09 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
say "## L: local capture path (#12848, no captureBytes)"
for i in 1 2; do run "L echo stdout+stderr $i" LOCAL=1 TAG=r6le$i ST=s1$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
run "L 100 MiB + 5 MiB exit 7" LOCAL=1 TAG=r6lm ST=s13 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
run "L reload, then a second Shell turn" LOCAL=1 TAG=r6lrl ST=s14 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
say "## M: mixed O2 + local sessions in one Harness, 4 x 64 MiB concurrently"
SCRIPT=s7-concurrent.ts run "M mixed concurrent" TAG=r6mx N=4 ST_BASE=60 SO=67108864 SE=1048576 MIXED=1 CAPTURE=600000000
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-o2l.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o2l.log)"
say "## P: preview + R1-3 probes"
SCRIPT=s9-preview.ts run "P O2 path" LABEL=r6o ST_BASE=40 CASES="$(cat $R/r6-cases.json)"
SCRIPT=s9-preview.ts run "P local path" LOCAL=1 LABEL=r6l ST_BASE=46 CASES="$(cat $R/r6-cases.json)"
say "## G: deferred gates"
run "G crash after admission prepare (O2)" TAG=r6g ST=s16 HOLD_KILL='/admissions/prepare'
DB=o2l LABEL=r6-real-o2 TRIALS=4 ST_BASE=70 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
DB=o2l LOCAL=1 LABEL=r6-real-local TRIALS=2 ST_BASE=74 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
say "## D: merged six-Workspace driver (files x2 + local Shell x4)"
BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh pr8 $PR | tee -a $LOG
BROKER_TOKEN=hosted-tools-broker-token DB=o2l LABEL=r6a $TSX $R/s6b-driver6.mjs s20,s21,s22,s23,s24,s25 2>&1 | tail -3 | tee -a $LOG
BROKER_TOKEN=hosted-tools-broker-token DB=o2l LABEL=r6b $TSX $R/s6b-driver6.mjs s26,s27,s28,s29,s30,s31 2>&1 | tail -3 | tee -a $LOG
say "## done"
