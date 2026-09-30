#!/bin/bash
# Real Aliyun OSS pass on PR head 42e2e8b1 (jar pr14), MySQL schema o3a; Spring started by up-real.sh (spring-real.sh).
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
export DB=o3a HARNESS_WT=$HOME/git/qwen-code-pr12894 ROOTS=$R/roots-real JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token REAL_OSS=1
LOG=$R/out/ro-42e2e8b1.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|bytes|range|reload|status after|second turn|hold|crash|load|harness|run|total|model-saw-bytes)|^\[[a-zA-Z0-9]|^\[  " | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-260 | tee -a $LOG; }
cd $R
say "## real OSS bucket $(cat $R/../realoss/bucket.txt | sed 's/-[0-9a-f]*$/-xxxxxx/') load $(uptime | sed 's/.*averages: //')"
run "RO crash after receipt commit" TAG=ro-hk ST=s03 HOLD_KILL='/receipts/commit'
run "RO segment request lost once" TAG=ro-f1 ST=s04 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "RO admission prepare reply lost once" TAG=ro-f5 ST=s05 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]'
run "RO control chars + crash after receipt" TAG=ro-f9 ST=s06 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
run "RO reload, then a second Shell turn" TAG=ro-rl ST=s07 CMD="echo turn" RELOAD_AFTER=1 SECOND=1
SCRIPT=s7-concurrent.ts run "RO 2 O2 Sessions x 64 MiB concurrently" TAG=ro-mx N=2 ST_BASE=8 SO=67108864 SE=1048576 CAPTURE=600000000
SCRIPT=s9-preview.ts run "RO preview matrix (O2)" LABEL=ro-p ST_BASE=21 CASES="$(cat $R/r7-cases.json)"
LABEL=ro-real-o2 TRIALS=2 ST_BASE=40 N=3000 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|summary" | cut -c1-240 | tee -a $LOG
say "## done load $(uptime | sed 's/.*averages: //')"
