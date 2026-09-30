#!/bin/bash
# Round 14: PR head af962df7 (R13-1 fix), fake OSS, MySQL schema o4a (shared with the s20/s15 probes), roots-r14. Focused regression.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894
export DB=o4a HARNESS_WT=$PR ROOTS=$R/roots-r14 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r14-af962df7.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|range|reload|status after|second turn|hold|crash|load|harness|journal|run|total|broker\] POST /executions/[0-9a-f]+:(start|acknowledge))|^\[[0-9a-zA-Z,]|^\[  " | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-300 | tee -a $LOG; }
cd $R
say "head $(git -C $PR rev-parse --short HEAD) load $(uptime | sed 's/.*averages: //')"
say "## A: O2 publication path (captureBytes set)"
for i in 1 2; do run "A echo stdout+stderr $i" TAG=r14e$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "A 100MiB+5MiB exit 7" TAG=r14m100 ST=s03 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
run "A crash after receipt commit" TAG=r14hk ST=s05 HOLD_KILL='/receipts/commit'
run "A segment request lost once" TAG=r14f1 ST=s06 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "A admission prepare reply lost once" TAG=r14f5 ST=s07 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]'
run "A control chars + crash after receipt" TAG=r14f9 ST=s08 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
run "A reload, then a second Shell turn" TAG=r14rl ST=s09 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
run "A ACK request lost, then reload + second turn" TAG=r14ak ST=s10 CMD="echo ack" BROKER_DROP=':acknowledge$' RELOAD_AFTER=1 SECOND=1
run "A R7-1 renewal after settle (receipt commit delayed 12 s)" TAG=r14rn ST=s15 CMD="echo renew" RULES='[{"match":"/receipts/commit","action":"delay","ms":12000,"count":1}]'
say "## L: local capture path (#12848, no captureBytes)"
for i in 1 2; do run "L echo stdout+stderr $i" LOCAL=1 TAG=r14le$i ST=s1$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
run "L 100 MiB + 5 MiB exit 7" LOCAL=1 TAG=r14lm ST=s13 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
run "L reload, then a second Shell turn" LOCAL=1 TAG=r14lrl ST=s14 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
say "## M: mixed O2 + local sessions in one Harness, 4 x 64 MiB concurrently"
SCRIPT=s7-concurrent.ts run "M mixed concurrent" TAG=r14mx N=4 ST_BASE=17 SO=67108864 SE=1048576 MIXED=1 CAPTURE=600000000
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-o4a.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o4a.log)"
say "## P: preview matrix (rounds 6-7) + R1-3 probes"
SCRIPT=s9-preview.ts run "P O2 path" LABEL=r14o ST_BASE=21 CASES="$(cat $R/r7-cases.json)"
SCRIPT=s9-preview.ts run "P local path" LOCAL=1 LABEL=r14l ST_BASE=35 CASES="$(cat $R/r7-cases.json)"
say "## T: combined-tail UTF-8 fixtures (c670bf45)"
SCRIPT=s9-preview.ts run "T O2 path" LABEL=r14t-o ST_BASE=49 CASES="$(cat $R/r8-tail-cases.json)"
SCRIPT=s9-preview.ts run "T local path" LOCAL=1 LABEL=r14t-l ST_BASE=59 CASES="$(cat $R/r8-tail-cases.json)"
say "## R: review-fix probes (R2-6 digest, Shell argument validation, R2-5 unstarted)"
SCRIPT=s13-digest.ts run "R2-6 canonical digest (O2)" LABEL=r14dig ST_BASE=92
SCRIPT=s13-digest.ts run "Shell argument validation (O2)" CASESET=validation LABEL=r14val-o ST_BASE=101
SCRIPT=s13-digest.ts run "Shell argument validation (local)" CASESET=validation LOCAL=1 LABEL=r14val-l ST_BASE=105
SCRIPT=s13-digest.ts run "lone surrogates (O2)" CASESET=surrogate LABEL=r14sur-o ST_BASE=111
SCRIPT=s13-digest.ts run "lone surrogates (local)" CASESET=surrogate LOCAL=1 LABEL=r14sur-l ST_BASE=114
SCRIPT=s14-cancel-prestart.ts run "R2-5 cancel before start (O2)" ST=s109 TAG=r14cx
SCRIPT=s14-cancel-prestart.ts run "R2-5 cancel before start (local)" LOCAL=1 ST=s110 TAG=r14cxl
say "## G: gates"
SCRIPT=s12-abs-read.ts run "G2 absolute read_file (O2)" ST=s77 TAG=r14abs-o2
SCRIPT=s12-abs-read.ts run "G2 absolute read_file (local)" LOCAL=1 ST=s78 TAG=r14abs-loc
run "G1 crash after admission prepare (O2)" TAG=r14g ST=s16 HOLD_KILL='/admissions/prepare'
LABEL=r14-real-o2 TRIALS=2 ST_BASE=71 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
LOCAL=1 LABEL=r14-real-local TRIALS=2 ST_BASE=75 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
say "## done load $(uptime | sed 's/.*averages: //')"
