#!/bin/bash
# PR #13654 real-stack matrix. usage: matrix.sh <arm> [groups]
#   arms: A = base jar + base worker (pre-PR sync)   B = head jar ASYNC=1 + head worker
#         C = head jar, async flag default (off) + head worker   D = head jar ASYNC=1 + base worker (legacy client)
R=$(cd $(dirname $0); pwd)
HEAD=$HOME/git/qwen-code-pr13654; BASE=$HOME/git/qwen-code-pr13654-base
ARM=$1; GRPS=${2:-N H T C L}
case $ARM in
  A) JAR=base; WT=$BASE; DB=p654xa; AS=;;
  B) JAR=head; WT=$HEAD; DB=p654xb; AS=1;;
  C) JAR=head; WT=$HEAD; DB=p654xc; AS=;;
  D) JAR=head; WT=$BASE; DB=p654xd; AS=1;;
esac
ROOTS=$R/roots-$ARM; mkdir -p $ROOTS
LOG=matrix-$ARM
say() { echo "$*" | tee -a $R/out/$LOG.log; }
up() { $R/stop-spring.sh >/dev/null; ( export DB ROOTS; [ -n "$AS" ] && export ASYNC=$AS; env "$@" $R/up.sh $JAR $WT | tail -1 | tee -a $R/out/$LOG.log ); say "## arm=$ARM jar=$JAR worker+harness=$(git -C $WT rev-parse --short HEAD) db=$DB async=${AS:-default} $*"; }
n=${N0:-0}
run() { local label=$1; shift; n=$((n+1)); $R/run.sh $LOG "$ARM$n $label" DB=$DB ROOTS=$ROOTS ${AS:+ASYNC=$AS} JAR_ARM=$JAR WORKER_WT=$WT WT=$WT HARNESS_WT=$WT ST=$(printf 's%02d' $((n))) TAG=$(echo $ARM | tr A-Z a-z)$n-$(date +%s) "$@" > /dev/null; }
up
for g in $GRPS; do case $g in
  N) for i in 1 2 3; do run "normal 5 MiB stdout + 1 MiB stderr (repeat $i)"; done;;
  H) run "readback held: first POST while every object GET is held (8 s)" HOLD=1 HOLD_MS=8000 HOLD_WAIT=15000;;
  T) for i in 1 2; do run "slow storage: object GET throttled to 4 MiB/s, 16 MiB stdout (repeat $i)" GET_BPS=4194304 SO=16777216 SE=4096; done;;
  C) run "corruption while held: flip one byte of the newest object, then release" HOLD=1 HOLD_MS=4000 HOLD_WAIT=15000 HOLD_ACTION=corrupt-then-release;;
  L) run "large: 64 MiB stdout + 8 MiB stderr" SO=67108864 SE=8388608 TIMEOUT=900000;;
  P) run "replay of a SUCCEEDED async op (publication still open), then corrupt its object" HOLD=1 HOLD_MS=2000 HOLD_ACTION=replay SO=8388608;;
  K) run "restart: SIGKILL Spring while an accepted op waits on held readback, restart, release" HOLD=1 HOLD_MS=4000 HOLD_ACTION=restart-then-release;;
  U) run "slow PUT: the first object PUT takes 5 s; acceptance must wait for it" OSS_FAULTS='[{"op":"put","mode":"delay","ms":5000,"count":1}]';;
  E) run "transient readback failure: the first six object GETs answer 500 (beyond the SDK retries)" OSS_FAULTS='[{"op":"get","mode":"500","count":6}]';;
  R) run "rollback: accepted under ASYNC=1, restart with async admission off, release" HOLD=1 HOLD_MS=4000 HOLD_ACTION=restart-then-release RESTART_ARGS=ASYNC=0;;
esac; done
say "## arm $ARM done $(date +%T)"
