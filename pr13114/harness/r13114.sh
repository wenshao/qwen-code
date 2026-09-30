#!/bin/bash
# PR #13114 real-stack matrix (fake OSS). usage: r13114.sh <arm label> <jar label> <worker/harness worktree> <db> <group> [storage prefix]
# groups: F (R15 matrix, op 6s / claim 3s, vbps 16 MiB/s), S (seal cases), T (throttled byte-aware windows), M (mixed subset)
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr13114/node_modules/.bin/tsx
ARM=$1; JAR=$2; WT=$3; DB=$4; GROUP=$5; P=${6:-$ARM}
export DB HARNESS_WT=$WT ROOTS=$R/roots-$ARM JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
LOG=$R/out/r13114-$ARM-$GROUP.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/s3-faults.ts 2>&1 | grep -E "^\[(turn|side-effects|proxy|catalog|objects|ops-|bytes|load|hold|crash|harness|journal|status|history|assistant|oss)" | grep -v "harness.*\[\]$" | cut -c1-400 | tee -a $LOG; }
up() { $R/stop-spring.sh; (cd $R && env "$@" DB=$DB ROOTS=$R/roots-$ARM BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up.sh $JAR $WT | tee -a $LOG); say "## arm=$ARM jar=$JAR harness+worker=$(git -C $WT rev-parse --short HEAD) db=$DB $*"; }
throttle() { curl -s -X POST http://127.0.0.1:18994/throttle -d "{\"getBps\":$1}" >/dev/null; say "## fake OSS GET throttle ${1} B/s"; }
SEG='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":1}}]'
FIN='[{"match":"/finish(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":9000,"count":1}}]'
SEGX='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":8}}]'
FINX='[{"match":"/finish(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":9000,"count":8}}]'
CLAIM='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":4500,"count":1}}]'
SEGD='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss-drop-reply","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":1}}]'
FIND='[{"match":"/finish(\\?|$)","action":"arm-oss-drop-reply","count":1,"oss":{"op":"get","mode":"delay","ms":9000,"count":1}}]'
FINC='[{"match":"/finish(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":4500,"count":1}}]'
SEAL='[{"match":"/streams/stdout/seal(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":9000,"count":1}}]'
SEALC='[{"match":"/streams/stdout/seal(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":4500,"count":1}}]'
cd $R
case $GROUP in
F)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=16777216 PUB_VMAX=25m
  LEDGER_LINES=20 run "F1 baseline, no faults" TAG=${P}f1 ST=p11
  run "F2 segment stdout/2: its object PUT takes 9 s (> 6 s deadline) once" TAG=${P}f2 ST=p12 RULES="$SEG"
  run "F3 finish: the first object GET of its read-back takes 9 s once" TAG=${P}f3 ST=p13 RULES="$FIN"
  CAPTURE_MATCH='/segments/stdout/2' run "F4 segment stdout/2: 8 slow PUTs in a row (recoveries exhausted)" TAG=${P}f4 ST=p14 RULES="$SEGX" TIMEOUT=240000 LEDGER_LINES=30
  run "F5 finish: 8 slow GETs in a row (recoveries exhausted)" TAG=${P}f5 ST=p15 RULES="$FINX" TIMEOUT=240000 LEDGER_LINES=30
  run "F6 segment stdout/2: object PUT takes 4.5 s once (claim 3 s expires, 6 s deadline does not)" TAG=${P}f6 ST=p16 RULES="$CLAIM"
  run "F7 segment stdout/2: object PUT takes 9 s once and the reply to the producer is lost" TAG=${P}f7 ST=p17 RULES="$SEGD"
  run "F8 finish: first read-back GET takes 9 s once and the reply to the producer is lost" TAG=${P}f8 ST=p18 RULES="$FIND"
  ;;
S)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=16777216 PUB_VMAX=25m
  run "F9 finish: first read-back GET takes 4.5 s once (claim-only lapse on the terminal scan)" TAG=${P}f9 ST=p19 RULES="$FINC"
  run "F10 seal stdout: first read-back GET takes 9 s once (> 7 s seal window)" TAG=${P}f10 ST=p20 RULES="$SEAL"
  run "F11 seal stdout: first read-back GET takes 4.5 s once (claim-only lapse on the seal scan)" TAG=${P}f11 ST=p21 RULES="$SEALC"
  ;;
M)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=16777216 PUB_VMAX=25m
  run "F2 segment stdout/2: its object PUT takes 9 s (> 6 s deadline) once" TAG=${P}f2 ST=p32 RULES="$SEG"
  run "F3 finish: the first object GET of its read-back takes 9 s once" TAG=${P}f3 ST=p33 RULES="$FIN"
  run "F6 segment stdout/2: object PUT takes 4.5 s once (claim 3 s expires, 6 s deadline does not)" TAG=${P}f6 ST=p36 RULES="$CLAIM"
  run "F9 finish: first read-back GET takes 4.5 s once (claim-only lapse on the terminal scan)" TAG=${P}f9 ST=p39 RULES="$FINC"
  run "F10 seal stdout: first read-back GET takes 9 s once (> 7 s seal window)" TAG=${P}f10 ST=p40 RULES="$SEAL"
  ;;
X)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=16777216 PUB_VMAX=25m
  TAMPER_B='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":1}},{"match":"/segments/stdout/2(\\?|$)","action":"corrupt-body","count":1}]'
  TAMPER_O='[{"match":"/segments/stdout/2(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"put","mode":"delay","ms":9000,"count":1}},{"match":"/segments/stdout/2(\\?|$)","action":"rewrite-op","count":1}]'
  run "F12 F2, then the replay after recovery carries one changed byte (same operation id)" TAG=${P}f12 ST=p22 RULES="$TAMPER_B" LEDGER_LINES=20
  run "F13 F2, then the replay after recovery carries another operation id (same bytes)" TAG=${P}f13 ST=p23 RULES="$TAMPER_O" LEDGER_LINES=20
  ;;
T)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=4194304 PUB_VMAX=25m
  throttle 8388608
  run "T1 100 MiB + 1 MiB, object GETs at 8 MiB/s (seal/finish ~13 s > 6 s base), floor 4 MiB/s" TAG=${P}t1 ST=p41 SO=104857600 SE=1048653 TIMEOUT=600000
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=67108864 PUB_VMAX=25m
  throttle 8388608
  run "T2 same, but the configured floor is optimistic (64 MiB/s): window 8 s < read time" TAG=${P}t2 ST=p42 SO=104857600 SE=1048653 TIMEOUT=600000 LEDGER_LINES=30
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=33554432 PUB_VMAX=25m
  throttle 67108864
  run "T3 1 GiB + 1 MiB, object GETs at 64 MiB/s (seal/finish ~16 s), floor 32 MiB/s" TAG=${P}t3 ST=p43 SO=1073741824 SE=1048653 CAPTURE=1200000000 TIMEOUT=900000
  throttle 0
  ;;
R)
  up PUB_OPTIMEOUT=6s PUB_CLAIM=3s PUB_VBPS=4194304 PUB_VMAX=25m
  throttle 8388608
  STALL='[{"match":"/streams/stdout/seal(\\?|$)","action":"arm-oss","count":1,"oss":{"op":"get","mode":"delay","ms":35000,"count":1}}]'
  run "T4 100 MiB at 8 MiB/s, floor 4 MiB/s (31 s seal window); the first seal read stalls 35 s, so recovery must re-read 100 MiB" TAG=${P}t4 ST=${RST:-p44} SO=104857600 SE=1048653 RULES="$STALL" TIMEOUT=600000 LEDGER_LINES=20
  throttle 0
  ;;
esac
say "EmptyResult: $(grep -c EmptyResultDataAccessException $R/run/spring-$DB.log)  Deadlock/LockWait: $(grep -ci 'deadlock\|lock wait timeout' $R/run/spring-$DB.log)"
say "## done $(date +%T)"
