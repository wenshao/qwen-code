#!/bin/bash
# Final pass on PR head 6b2bc23cba, fresh MySQL schema o2c.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894; C4=$HOME/git/qwen-code-pr12894-cand4
export DB=o2c
LOG=$R/out/final-6b2bc23c.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|bytes|range|reload|status after|hold|crash|load|oss|harness|journal|broker\] POST /executions/[0-9a-f]+:start)" | grep -v "range std.*past end\|harness.*\[\]$" | cut -c1-240 | tee -a $LOG; }
cd $R
PUB_PORT=18895 $R/up.sh pr3 $PR | tee -a $LOG
say "## Stage A: PR as-is (jar + Harness + worker at 6b2bc23c)"
for i in 1 2; do run "A$i echo" HARNESS_WT=$PR TAG=fA$i ST=s0$i CMD="echo a$i; echo e$i >&2" TIMEOUT=60000; done
say "## Stage B: PR jar + candidate Harness (B1 fixed only)"
run "B1 echo" HARNESS_WT=$C4 TAG=fB1 ST=s03 CMD="echo b1" TIMEOUT=40000
PUB_PORT=18895 $R/up.sh cand4 $C4 | tee -a $LOG
say "## Stage C: candidate (B1+B2+B4) on 6b2bc23c"
for i in 4 5 6; do run "C echo stdout+stderr $i" HARNESS_WT=$C4 TAG=fC$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "C 100MiB+5MiB exit 7" HARNESS_WT=$C4 TAG=fC100 ST=s07 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
run "C fault: segment reply lost" HARNESS_WT=$C4 TAG=fCfa ST=s08 RULES='[{"match":"/segments/stdout/2","action":"drop-reply","count":1}]'
run "C fault: segment request lost" HARNESS_WT=$C4 TAG=fCfb ST=s09 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "C fault: finish reply lost" HARNESS_WT=$C4 TAG=fCfd ST=s10 RULES='[{"match":"/finish","action":"drop-reply","count":1}]'
run "C fault: OSS PUT stored, reply lost" HARNESS_WT=$C4 TAG=fCob ST=s11 OSS_FAULTS='[{"op":"put","mode":"drop-reply","count":1,"skip":2,"match":"managed-tool-results"}]'
run "C fault: admission prepare reply lost" HARNESS_WT=$C4 TAG=fCga ST=s12 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]' RELOAD_AFTER=1
run "C crash after receipt commit" HARNESS_WT=$C4 TAG=fChk ST=s13 HOLD_KILL='/receipts/commit'
for i in 1 2; do SCRIPT=s1-big-shell.ts run "C 1GiB #$i" HARNESS_WT=$C4 TAG=fC1g$i ST=s1$((i+3)) SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000; done
say "EmptyResultDataAccessException in log: $(grep -c EmptyResultDataAccessException $R/run/spring-o2c.log)"
BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh pr3 $PR | tee -a $LOG
say "## Stage D: author's Hosted file-tool driver on PR as-is"
BROKER_TOKEN=hosted-tools-broker-token LABEL=pr3-files $TSX $R/s6-author-driver.mjs s20,s21 2>&1 | tail -3 | tee -a $LOG
PUB_PORT=18895 $R/up.sh cand4 $C4 >/dev/null
say "## done"
