#!/bin/bash
# Round 7: PR head 033c74d3 (merge of main a77d80d1 carrying the R6-1/R6-2 fixes), fresh MySQL schema o2m, fresh roots.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894
export DB=o2m HARNESS_WT=$PR ROOTS=$R/roots-r7 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r7-033c74d3.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|range|reload|status after|second turn|hold|crash|load|harness|journal|run|total|broker\] POST /executions/[0-9a-f]+:(start|acknowledge))|^\[[0-9a-zA-Z,]|^\[  " | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-260 | tee -a $LOG; }
cd $R
say "head $(git -C $PR rev-parse --short HEAD) load $(uptime | sed 's/.*averages: //')"
BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh pr9 $PR | tee -a $LOG
say "## A: O2 publication path (captureBytes set)"
for i in 1 2; do run "A echo stdout+stderr $i" TAG=r7e$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "A 100MiB+5MiB exit 7" TAG=r7m100 ST=s03 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
SCRIPT=s1-big-shell.ts run "A 1GiB" TAG=r7g1 ST=s04 SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000
run "A crash after receipt commit" TAG=r7hk ST=s05 HOLD_KILL='/receipts/commit'
run "A segment request lost once" TAG=r7f1 ST=s06 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "A admission prepare reply lost once" TAG=r7f5 ST=s07 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]'
run "A control chars + crash after receipt" TAG=r7f9 ST=s08 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
run "A reload, then a second Shell turn" TAG=r7rl ST=s09 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
run "A ACK request lost, then reload + second turn" TAG=r7ak ST=s10 CMD="echo ack" BROKER_DROP=':acknowledge$' RELOAD_AFTER=1 SECOND=1
run "A ACK reply lost, then reload + second turn" TAG=r7ar ST=s15 CMD="echo ack" BROKER_DROP=':acknowledge$' BROKER_ACTION=drop-reply RELOAD_AFTER=1 SECOND=1
say "## L: local capture path (#12848, no captureBytes)"
for i in 1 2; do run "L echo stdout+stderr $i" LOCAL=1 TAG=r7le$i ST=s1$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
run "L 100 MiB + 5 MiB exit 7" LOCAL=1 TAG=r7lm ST=s13 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
run "L reload, then a second Shell turn" LOCAL=1 TAG=r7lrl ST=s14 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
say "## M: mixed O2 + local sessions in one Harness, 4 x 64 MiB concurrently"
SCRIPT=s7-concurrent.ts run "M mixed concurrent" TAG=r7mx N=4 ST_BASE=17 SO=67108864 SE=1048576 MIXED=1 CAPTURE=600000000
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-o2m.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o2m.log)"
say "## P: preview matrix (R6-1) + R1-3 probes"
SCRIPT=s9-preview.ts run "P O2 path" LABEL=r7o ST_BASE=40 CASES="$(cat $R/r7-cases.json)"
SCRIPT=s9-preview.ts run "P local path" LOCAL=1 LABEL=r7l ST_BASE=54 CASES="$(cat $R/r7-cases.json)"
say "## S: load scaling (R6-2)"
SCRIPT=s11-reload-scaling.ts run "S O2 1/10/40/80" ST=s21 TAG=r7sc-o2 CHECKS=1,10,40,80
SCRIPT=s11-reload-scaling.ts run "S local 1/10/40" LOCAL=1 ST=s22 TAG=r7sc-loc CHECKS=1,10,40
say "## G: deferred gates"
run "G crash after admission prepare (O2)" TAG=r7g ST=s16 HOLD_KILL='/admissions/prepare'
LABEL=r7-real-o2 TRIALS=4 ST_BASE=70 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
LOCAL=1 LABEL=r7-real-local TRIALS=2 ST_BASE=74 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
say "## D: merged six-Workspace driver (files x2 + local Shell x4)"
BROKER_TOKEN=hosted-tools-broker-token LABEL=r7a $TSX $R/s6b-driver6.mjs s25,s26,s27,s28,s29,s30 2>&1 | tail -3 | tee -a $LOG
BROKER_TOKEN=hosted-tools-broker-token LABEL=r7b $TSX $R/s6b-driver6.mjs s31,s32,s33,s34,s35,s36 2>&1 | tail -3 | tee -a $LOG
say "## done load $(uptime | sed 's/.*averages: //')"
