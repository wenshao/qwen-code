#!/bin/bash
# Round 3: PR head 678420df as-is, fresh MySQL schema o2h (+ o2i for capacity).
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894
export DB=o2h HARNESS_WT=$PR
LOG=$R/out/r4-678420df.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|bytes|range|reload|status after|hold|crash|load|harness|journal|run|total|broker\] POST /executions/[0-9a-f]+:(start|acknowledge))|^\[(ascii|CJK|  )" | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-240 | tee -a $LOG; say "--- end $label ($(date +%T))"; }
cd $R
PUB_PORT=18895 $R/up.sh pr6 $PR | tee -a $LOG
say "## A: regression on PR head as-is"
for i in 1 2 3; do run "A echo stdout+stderr $i" TAG=r4e$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "A 100MiB+5MiB exit 7" TAG=r4m100 ST=s04 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
run "A crash after receipt commit" TAG=r4hk ST=s05 HOLD_KILL='/receipts/commit'
for i in 1 2; do SCRIPT=s1-big-shell.ts run "A 1GiB #$i" TAG=r4g$i ST=s1$i SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000; done
SCRIPT=s7-concurrent.ts run "A 4 sessions x 256 MiB concurrently" TAG=r4k N=4 ST_BASE=50 SO=268435456 SE=1048576 CAPTURE=600000000
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-o2h.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o2h.log)"
say "## F: round-1/2 open items"
run "F1 segment request lost once" TAG=r4f1 ST=s06 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "F2 segment 503 once" TAG=r4f2 ST=s07 RULES='[{"match":"/segments/stdout/2","action":"503","count":1}]'
run "F3 all segment POSTs 503 for 90 s" TAG=r4f3 ST=s08 RULES='[{"match":"/segments/","action":"503","count":100000,"forMs":90000}]' TIMEOUT=600000
run "F4 OSS PUT 403 once" TAG=r4f4 ST=s09 OSS_FAULTS='[{"op":"put","mode":"403","count":1,"skip":2,"match":"managed-tool-results"}]' TIMEOUT=600000
run "F5 admission prepare reply lost once" TAG=r4f5 ST=s10 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]'
run "F6 receipt commit reply lost once" TAG=r4f6 ST=s20 RULES='[{"match":"/receipts/commit","action":"drop-reply","count":1}]'
run "F7 admission prepare reply lost 3x (retries exhausted)" TAG=r4f7 ST=s21 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":3}]' RELOAD_AFTER=1
run "F8 control chars" TAG=r4f8 ST=s22 CMD="sh $R/ctl.sh" TIMEOUT=120000
run "F9 control chars + crash after receipt" TAG=r4f9 ST=s23 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
run "F10 crash after admission prepare (reply withheld)" TAG=r4f10 ST=s24 HOLD_KILL='/admissions/prepare'
say "=== F11 range coercion"; DB=o2h SRC=s3-r4f2 $TSX $R/s5-range-coerce.ts 2>&1 | tail -5 | cut -c1-160 | tee -a $LOG
say "## M: Hosted preview"
SCRIPT=s8-preview.ts run "M preview cases" LABEL=r4 ST_BASE=40
say "## D: author's file-tool driver"
BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh pr6 $PR | tee -a $LOG
BROKER_TOKEN=hosted-tools-broker-token LABEL=pr6-files $TSX $R/s6-author-driver.mjs s30,s31 2>&1 | tail -2 | tee -a $LOG
say "## C: capacity, schema o2i, tenant capacity for 2 reservations"
export DB=o2i
PUB_TENANT=600000000 PUB_PORT=18895 $R/up.sh pr6 $PR | tee -a $LOG
run "C orphan 1" TAG=r4cap1 ST=s01 CMD="echo cap1" HOLD_KILL='/grants' NO_RECOVER=1
run "C orphan 2" TAG=r4cap2 ST=s02 CMD="echo cap2" HOLD_KILL='/grants' NO_RECOVER=1
until [ "$($R/sql.sh -N -e "SELECT COUNT(*) FROM qwen_tool_publication WHERE state='OPEN' AND expires_at > UNIX_TIMESTAMP(NOW(3))*1000")" = "0" ]; do sleep 5; done
say "orphans expired at $(date +%T): $($R/sql.sh -N -e "SELECT state, producer_phase, capture_held_bytes+producer_held_bytes+admission_held_bytes FROM qwen_tool_publication" | tr '\n' ';')"
( run "C long-running Session L (96 s, renewing)" TAG=r4capL ST=s03 CMD="sh $R/slow.sh" TIMEOUT=300000 ) &
sleep 75
run "C Session 3 reserves while L is still running" TAG=r4cap3 ST=s04 CMD="echo cap3" TIMEOUT=60000
wait
say "rows after: $($R/sql.sh -N -e "SELECT LEFT(publication_id,8), state, producer_phase, capture_held_bytes+producer_held_bytes+admission_held_bytes, capture_used_bytes FROM qwen_tool_publication" | tr '\n' ';')"
say "## R: real model (qwen3.8-max), build.sh 3000 lines + stderr error"
export DB=o2h
PUB_PORT=18895 $R/up.sh pr6 $PR | tee -a $LOG
DB=o2h LABEL=r4-real TRIALS=4 ST_BASE=60 $TSX $R/s2-real-model.ts 2>&1 | grep "\] admit\|model-call\|summary" | cut -c1-260 | tee -a $LOG
say "## done"
