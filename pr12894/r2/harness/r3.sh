#!/bin/bash
# Round 3: PR head 50acc2a6 as-is, fresh MySQL schema o2f.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
PR=$HOME/git/qwen-code-pr12894
export DB=o2f HARNESS_WT=$PR
LOG=$R/out/r3-50acc2a6.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|bytes|range|reload|status after|hold|crash|load|oss|harness|journal|run|total|broker\] POST /executions/[0-9a-f]+:(start|acknowledge))" | grep -v "range std.*past end\|harness.*\[\]$\|writers:acquire" | cut -c1-240 | tee -a $LOG; }
cd $R
PUB_PORT=18895 $R/up.sh pr5 $PR | tee -a $LOG
say "## A: core claims on PR head as-is"
for i in 1 2 3; do run "A echo stdout+stderr $i" TAG=r3e$i ST=s0$i CMD="echo hi-$i; echo err-$i >&2" TIMEOUT=60000; done
SCRIPT=s1-big-shell.ts run "A 100MiB+5MiB exit 7" TAG=r3m100 ST=s04 SO=104857600 SE=5242880 CODE=7 TIMEOUT=900000
for i in 1 2 3 4; do SCRIPT=s1-big-shell.ts run "A 1GiB #$i" TAG=r3g$i ST=s1$i SO=1073741824 SE=3145728 CAPTURE=2147483648 TIMEOUT=1500000; done
say "EmptyResultDataAccessException: $(grep -c EmptyResultDataAccessException $R/run/spring-o2f.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o2f.log)"
run "A crash after receipt commit" TAG=r3hk ST=s05 HOLD_KILL='/receipts/commit'
say "## A: fault matrix (report section 3)"
run "F segment reply lost" TAG=r3fa ST=s06 RULES='[{"match":"/segments/stdout/2","action":"drop-reply","count":1}]'
run "F segment request lost" TAG=r3fb ST=s07 RULES='[{"match":"/segments/stdout/2","action":"drop-request","count":1}]'
run "F segment 503 once" TAG=r3fc ST=s08 RULES='[{"match":"/segments/stdout/2","action":"503","count":1}]'
run "F admission prepare reply lost" TAG=r3ga ST=s09 RULES='[{"match":"/admissions/prepare","action":"drop-reply","count":1}]' RELOAD_AFTER=1
run "F receipt commit reply lost (in-process)" TAG=r3gb ST=s10 RULES='[{"match":"/receipts/commit","action":"drop-reply","count":1}]' RELOAD_AFTER=1
run "F OSS PUT stored, reply lost" TAG=r3ob ST=s20 OSS_FAULTS='[{"op":"put","mode":"drop-reply","count":1,"skip":2,"match":"managed-tool-results"}]'
run "F control chars" TAG=r3cc ST=s21 CMD="sh $R/ctl.sh" TIMEOUT=120000
run "F control chars + crash after receipt (bot point a)" TAG=r3cchk ST=s22 CMD="sh $R/ctl.sh" HOLD_KILL='/receipts/commit'
say "## B: 4 sessions x 256 MiB concurrently (FOR UPDATE contention)"
SCRIPT=s7-concurrent.ts run "B concurrent" TAG=r3c N=4 ST_BASE=50 SO=268435456 SE=1048576
say "EmptyResultDataAccessException: $(grep -c EmptyResultDataAccessException $R/run/spring-o2f.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-o2f.log)"
say "InnoDB latest deadlock: $($R/sql.sh -N -e 'SHOW ENGINE INNODB STATUS' | grep -c 'LATEST DETECTED DEADLOCK')"
BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh pr5 $PR | tee -a $LOG
say "## C: author's Hosted file-tool driver on PR as-is"
BROKER_TOKEN=hosted-tools-broker-token LABEL=pr5-files $TSX $R/s6-author-driver.mjs s30,s31 2>&1 | tail -3 | tee -a $LOG

say "## D: capacity after owner loss between reserve and start (bot point b), schema o2g, tenant capacity for 2 reservations"
export DB=o2g
PUB_TENANT=600000000 PUB_PORT=18895 $R/up.sh pr5 $PR | tee -a $LOG
run "D orphan 1: /grants reply withheld, Harness SIGKILL" TAG=r3cap1 ST=s01 CMD="echo cap1" HOLD_KILL='/grants' NO_RECOVER=1
run "D orphan 2: /grants reply withheld, Harness SIGKILL" TAG=r3cap2 ST=s02 CMD="echo cap2" HOLD_KILL='/grants' NO_RECOVER=1
say "tenant rows: $($R/sql.sh -N -e "SELECT state, producer_phase, capture_held_bytes+producer_held_bytes+admission_held_bytes, FROM_UNIXTIME(expires_at/1000) FROM qwen_tool_publication" | tr '\n' ';')"
until [ "$($R/sql.sh -N -e "SELECT COUNT(*) FROM qwen_tool_publication WHERE expires_at > UNIX_TIMESTAMP(NOW(3))*1000")" = "0" ]; do sleep 5; done
say "both reservations past expires_at at $(date +%T)"
sleep 10
run "D fresh Session after both orphans expired" TAG=r3cap3 ST=s03 CMD="echo cap3" TIMEOUT=60000
say "held after: $($R/sql.sh -N -e "SELECT state, producer_phase, capture_held_bytes+producer_held_bytes+admission_held_bytes FROM qwen_tool_publication" | tr '\n' ';')"
say "server reason: $(grep 'Resolved \[' $R/run/spring-o2g.log | tail -2 | sed 's/.*Resolved/Resolved/' | tr '\n' ' ')"
say "## done"
