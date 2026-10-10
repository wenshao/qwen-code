#!/bin/bash
# Round 3 (head 915ab691 vs base 1f4484d3). usage: r3.sh <groups>
#   lane 1 = head3 jar, ASYNC=1, head worker (DB p654r3b)   lane 2 = main2 (=base) jar, base worker (DB p654r3a)
R=$(cd $(dirname $0); pwd); HEAD=$HOME/git/qwen-code-pr13654; BASE=$HOME/git/qwen-code-pr13654-base
LOG=r3; n=${N0:-0}
lane1() { LANE=1 $R/stop-l.sh >/dev/null; ( export DB=${DB1:-p654r3b} ROOTS=$R/roots-r3b; [ -n "${AS1-1}" ] && export ASYNC=${AS1-1}; LANE=1 $R/up-l.sh ${JAR1:-head3} ${WT1:-$HEAD} | tail -1 | tee -a $R/out/$LOG.log ); }
lane2() { LANE=2 $R/stop-l.sh >/dev/null; ( export DB=p654r3a ROOTS=$R/roots-r3a; LANE=2 $R/up-l.sh main2 $BASE | tail -1 | tee -a $R/out/$LOG.log ); }
one() { local lane=$1 label=$2; shift 2; n=$((n+1)); local wt=$HEAD db=${DB1:-p654r3b} arm=head jar=${JAR1:-head3}; [ $lane = 2 ] && { wt=$BASE; db=p654r3a; arm=base; jar=main2; }; [ $lane = 1 ] && wt=${WT1:-$HEAD}
  $R/r2run.sh $lane $LOG "R$n [$arm] $label" DB=$db WT=$wt HARNESS_WT=$wt WORKER_WT=$wt JAR_ARM=$jar ROOTS=$R/roots-r3$([ $lane = 2 ] && echo a || echo b) ${AS1+ASYNC=$AS1} ST=$(printf 's%02d' $n) TAG=r3-$n-$(date +%s) "$@" > /dev/null; }
F403='[{"match":"/finish(\\?|$)","method":"POST","action":"arm-oss","count":1,"oss":{"op":"get","mode":"403","count":1}}]'
for g in $1; do case $g in
  UP) lane1; lane2;;
  UP1) lane1;;
  CMP) one 1 "normal 5 MiB + 1 MiB"
       one 1 "readback held 8 s" HOLD=1 HOLD_MS=8000 HOLD_WAIT=15000;;
  F) one 1 "normal 5 MiB + 1 MiB"
     one 1 "readback held 8 s" HOLD=1 HOLD_MS=8000 HOLD_WAIT=15000
     one 2 "readback held 8 s" HOLD=1 HOLD_MS=8000 HOLD_WAIT=15000
     one 1 "first object PUT delayed 5 s" OSS_FAULTS='[{"op":"put","mode":"delay","ms":5000,"count":1}]'
     one 1 "first six object GETs answer 500" OSS_FAULTS='[{"op":"get","mode":"500","count":6}]'
     one 1 "flip one byte while readback is held" HOLD=1 HOLD_MS=4000 HOLD_WAIT=15000 HOLD_ACTION=corrupt-then-release
     one 1 "replay a SUCCEEDED op, then flip its object" HOLD=1 HOLD_MS=2000 HOLD_ACTION=replay SO=8388608
     one 1 "64 MiB + 8 MiB" SO=67108864 SE=8388608 CAPTURE=1073741824;;
  A) one 2 "R4-2: one AccessDenied on the first object GET after POST /finish" RULES="$F403"
     one 1 "R4-2: one AccessDenied on the first object GET after POST /finish" RULES="$F403";;
  L) one 2 "R5-1: journal commits (activation renewals) answer 503 for 70 s while readback is held" HOLD=1 HOLD_WAIT=15000 HOLD_MS=1000 HOLD_ACTION=lapse BLOCK_MS=70000
     one 1 "R5-1: journal commits (activation renewals) answer 503 for 70 s while readback is held" HOLD=1 HOLD_WAIT=15000 HOLD_MS=1000 HOLD_ACTION=lapse BLOCK_MS=70000;;
  K) one 1 "rollback: SIGKILL Spring after 202, restart with async admission off" HOLD=1 HOLD_MS=4000 HOLD_ACTION=restart-then-release RESTART_ARGS=ASYNC=0;;
esac; done
echo "## r3 $1 done $(date +%T)" | tee -a $R/out/$LOG.log
