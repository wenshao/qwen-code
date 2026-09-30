#!/bin/bash
# Round 15, R4-1 (expired publication operations) on the fake OSS.
# usage: r15-r41.sh <arm label> <jar> <worker/harness worktree> <db>
# Spring runs with operation-timeout=6s, claim-timeout=3s. Faults are armed on the
# fake OSS by the fault proxy when a given publication request passes (arm-oss).
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
ARM=$1; JAR=$2; WT=$3; DB=$4; P=${5:-r15}
export DB HARNESS_WT=$WT ROOTS=$R/roots-r15 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r15-r41b-$ARM.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/${SCRIPT:-s3-faults.ts} 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|ops-|bytes|load|hold|crash|harness|journal|status|history|assistant|oss)" | grep -v "harness.*\[\]$" | cut -c1-330 | tee -a $LOG; }
stop_spring() {
  local sp; sp=$(lsof -nP -iTCP:18894 -sTCP:LISTEN -t); [ -z "$sp" ] && return
  ps -o command= -p $sp | grep -q "server.port=18894" || { say "18894 is not the rig Spring"; exit 1; }
  local tp; tp=$(ps -ax -o pid=,command= | awk '/[E]xTap 15894/{print $1}')
  kill $sp $tp $(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}') 2>/dev/null
  for i in $(seq 1 30); do lsof -nP -iTCP:18894 -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
}
stop_spring
cd $R
PUB_OPTIMEOUT=6s PUB_CLAIM=3s DB=$DB ROOTS=$R/roots-r15 BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up14.sh $JAR $WT | tee -a $LOG
say "## arm=$ARM jar=$JAR harness+worker=$(git -C $WT rev-parse --short HEAD) db=$DB operation-timeout=6s claim-timeout=3s"
SEG='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":1}}]'
FIN='[{"match":"/finish(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":9000,"count":1}}]'
SEGX='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":8}}]'
FINX='[{"match":"/finish(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":9000,"count":8}}]'
:
CLAIM='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":4500,"count":1}}]'
SEGD='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss-drop-reply","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":1}}]'
FIND='[{"match":"/finish(\\?|$)","action":"arm-oss-drop-reply","count":1,"oss":{"op":"get","mode":"delay","ms":9000,"count":1}}]'
run "F6 segment stdout/2: object PUT takes 4.5 s once (claim 3 s expires, 6 s deadline does not)" TAG=${P}f6 ST=s16 RULES="$CLAIM"
run "F7 segment stdout/2: object PUT takes 9 s once and the reply to the producer is lost" TAG=${P}f7 ST=s17 RULES="$SEGD"
run "F8 finish: first read-back GET takes 9 s once and the reply to the producer is lost" TAG=${P}f8 ST=s18 RULES="$FIND"
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-$DB.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-$DB.log)"
say "## done"
