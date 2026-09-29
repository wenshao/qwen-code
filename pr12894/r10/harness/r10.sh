#!/bin/bash
# Round 10: PR head 0172d5ec (bf8a99b4 R9-1 fix + main merge with Broker payload validation), fresh MySQL schema o2s, fresh roots.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894
export DB=o2s HARNESS_WT=$PR ROOTS=$R/roots-r10 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r10-0172d5ec.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|range|reload|status after|second turn|hold|crash|load|harness|journal|run|total|broker\] POST /executions/[0-9a-f]+:(start|acknowledge))|^\[[0-9a-zA-Z,]|^\[  " | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-300 | tee -a $LOG; }
cd $R
say "head $(git -C $PR rev-parse --short HEAD) load $(uptime | sed 's/.*averages: //')"
PUB_PORT=18895 $R/up.sh pr12 $PR | tee -a $LOG
say "## A: O2 publication path (captureBytes set)"
for i in 1 2; do run "A echo stdout+stderr $i" TAG=r10e$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "A 100MiB+5MiB exit 7" TAG=r10m100 ST=s03 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
SCRIPT=s1-big-shell.ts run "A 1GiB" TAG=r10g1 ST=s04 SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000
run "A crash after receipt commit" TAG=r10hk ST=s05 HOLD_KILL='/receipts/commit'
run "A segment request lost once" TAG=r10f1 ST=s06 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "A admission prepare reply lost once" TAG=r10f5 ST=s07 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]'
run "A control chars + crash after receipt" TAG=r10f9 ST=s08 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
run "A reload, then a second Shell turn" TAG=r10rl ST=s09 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
run "A ACK request lost, then reload + second turn" TAG=r10ak ST=s10 CMD="echo ack" BROKER_DROP=':acknowledge$' RELOAD_AFTER=1 SECOND=1
run "A R7-1 renewal after settle (receipt commit delayed 12 s)" TAG=r10rn ST=s15 CMD="echo renew" RULES='[{"match":"/receipts/commit","action":"delay","ms":12000,"count":1}]'
say "## L: local capture path (#12848, no captureBytes)"
for i in 1 2; do run "L echo stdout+stderr $i" LOCAL=1 TAG=r10le$i ST=s1$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
run "L 100 MiB + 5 MiB exit 7" LOCAL=1 TAG=r10lm ST=s13 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
run "L reload, then a second Shell turn" LOCAL=1 TAG=r10lrl ST=s14 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
say "## M: mixed O2 + local sessions in one Harness, 4 x 64 MiB concurrently"
SCRIPT=s7-concurrent.ts run "M mixed concurrent" TAG=r10mx N=4 ST_BASE=17 SO=67108864 SE=1048576 MIXED=1 CAPTURE=600000000
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-o2s.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o2s.log)"
say "## P: preview matrix (rounds 6-7) + R1-3 probes"
SCRIPT=s9-preview.ts run "P O2 path" LABEL=r10o ST_BASE=21 CASES="$(cat $R/r7-cases.json)"
SCRIPT=s9-preview.ts run "P local path" LOCAL=1 LABEL=r10l ST_BASE=35 CASES="$(cat $R/r7-cases.json)"
say "## T: combined-tail UTF-8 fixtures (c670bf45)"
SCRIPT=s9-preview.ts run "T O2 path" LABEL=r10t-o ST_BASE=49 CASES="$(cat $R/r8-tail-cases.json)"
SCRIPT=s9-preview.ts run "T local path" LOCAL=1 LABEL=r10t-l ST_BASE=59 CASES="$(cat $R/r8-tail-cases.json)"
say "## R: review-fix probes (R2-6 digest, Shell argument validation, R2-5 unstarted)"
SCRIPT=s13-digest.ts run "R2-6 canonical digest (O2)" LABEL=r10dig ST_BASE=92
SCRIPT=s13-digest.ts run "Shell argument validation (O2)" CASESET=validation LABEL=r10val-o ST_BASE=101
SCRIPT=s13-digest.ts run "Shell argument validation (local)" CASESET=validation LOCAL=1 LABEL=r10val-l ST_BASE=105
SCRIPT=s13-digest.ts run "lone surrogates (O2)" CASESET=surrogate LABEL=r10sur-o ST_BASE=111
SCRIPT=s13-digest.ts run "lone surrogates (local)" CASESET=surrogate LOCAL=1 LABEL=r10sur-l ST_BASE=114
SCRIPT=s14-cancel-prestart.ts run "R2-5 cancel before start (O2)" ST=s109 TAG=r10cx
SCRIPT=s14-cancel-prestart.ts run "R2-5 cancel before start (local)" LOCAL=1 ST=s110 TAG=r10cxl
say "## S: load scaling (R6-2)"
SCRIPT=s11-reload-scaling.ts run "S O2 10/40/80" ST=s69 TAG=r10sc-o2 CHECKS=10,40,80
SCRIPT=s11-reload-scaling.ts run "S local 10/40" LOCAL=1 ST=s70 TAG=r10sc-loc CHECKS=10,40
say "## G: gates"
SCRIPT=s12-abs-read.ts run "G2 absolute read_file (O2)" ST=s77 TAG=r10abs-o2
SCRIPT=s12-abs-read.ts run "G2 absolute read_file (local)" LOCAL=1 ST=s78 TAG=r10abs-loc
run "G1 crash after admission prepare (O2)" TAG=r10g ST=s16 HOLD_KILL='/admissions/prepare'
LABEL=r10-real-o2 TRIALS=4 ST_BASE=71 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
LOCAL=1 LABEL=r10-real-local TRIALS=2 ST_BASE=75 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
say "## D: author's six-Workspace driver"
LABEL=r10a $TSX $R/s6b-driver6.mjs s80,s81,s82,s83,s84,s85 2>&1 | tail -3 | tee -a $LOG
LABEL=r10b $TSX $R/s6b-driver6.mjs s86,s87,s88,s89,s90,s91 2>&1 | tail -3 | tee -a $LOG
say "## done load $(uptime | sed 's/.*averages: //')"
