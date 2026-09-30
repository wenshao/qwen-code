#!/bin/bash
# PR #13114 recovery-window and long-scan cases (fake OSS). usage: r13114b.sh <arm> <jar> <worktree> <db> <group> [storage]
# R: T4 (a 35 s stall on the first seal read of 100 MiB, recovery must re-read within its window)
# L: T5 (1 GiB seal/finish longer than the producer's 30 s request timeout)
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr13114/node_modules/.bin/tsx
ARM=$1; JAR=$2; WT=$3; DB=$4; GROUP=$5; ST=${6:-p60}
export DB HARNESS_WT=$WT ROOTS=$R/roots-$ARM JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r13114b-$ARM-$GROUP.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/s3-faults.ts 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|ops-|bytes|harness|status|oss)" | grep -v "harness.*\[\]$" | cut -c1-400 | tee -a $LOG; }
up() { $R/stop-spring.sh; (cd $R && env "$@" DB=$DB ROOTS=$R/roots-$ARM BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh $JAR $WT | tee -a $LOG); say "## arm=$ARM jar=$JAR harness+worker=$(git -C $WT rev-parse --short HEAD) db=$DB $*"; }
throttle() { curl -s -X POST http://127.0.0.1:18994/throttle -d "{\"getBps\":$1}" >/dev/null; say "## fake OSS GET throttle ${1} B/s"; }
cd $R
case $GROUP in
R)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=4194304 PUB_VMAX=25m
  throttle 8388608
  STALL='[{"match":"/streams/stdout/seal(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":35000,"count":1}}]'
  run "T4 100 MiB at 8 MiB/s, floor 4 MiB/s (31 s seal window); the first seal read stalls 35 s, so recovery must re-read 100 MiB" TAG=${ARM}t4 ST=$ST SO=104857600 SE=1048653 RULES="$STALL" TIMEOUT=600000 LEDGER_LINES=20
  throttle 0
  ;;
L)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=8388608 PUB_VMAX=25m
  throttle 16777216
  run "T5 1 GiB + 1 MiB at 16 MiB/s (seal/finish ~64 s > the producer's 30 s request timeout), floor 8 MiB/s" TAG=${ARM}t5 ST=$ST SO=1073741824 SE=1048653 CAPTURE=1200000000 TIMEOUT=1200000 LEDGER_LINES=20
  throttle 0
  ;;
esac
say "## done $(date +%T)"
