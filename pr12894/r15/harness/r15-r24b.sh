#!/bin/bash
# Round 15, R2-4: resume while the Workspace is busy, before and after e177e1da.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
LOG=$R/out/r15-r24b.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
stop_spring() {
  local sp; sp=$(lsof -nP -iTCP:18894 -sTCP:LISTEN -t); [ -z "$sp" ] && return
  ps -o command= -p $sp | grep -q "server.port=18894" || { say "18894 is not the rig Spring"; exit 1; }
  local tp; tp=$(ps -ax -o pid=,command= | awk '/[E]xTap 15894/{print $1}')
  kill $sp $tp $(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}') 2>/dev/null
  for i in $(seq 1 30); do lsof -nP -iTCP:18894 -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
}
arm() { # label jar wt db
  stop_spring
  DB=$4 ROOTS=$R/roots-r15 BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up14.sh $2 $3 | tee -a $LOG
  export DB=$4 HARNESS_WT=$3 ROOTS=$R/roots-r15 JSON_TIMEOUT=900000 BROKER_TOKEN=hosted-tools-broker-token
  say "## $1: jar=$2 harness+worker=$(git -C $3 rev-parse --short HEAD) db=$4"
}
run() { local label=$1; shift; say "=== $label ($(date +%T))"; env "$@" $TSX $R/s21-resume-busy.ts 2>&1 | grep -E "^\[" | cut -c1-360 | tee -a $LOG; }
cd $R
arm before pr14 $HOME/git/qwen-code-pr12894-before15 o5b
run "R2-4: A's tool session released, Workspace then held by another holder (before)" TAG=r15rd1 ST=s51 MODE=busy-released
arm after pr15 $HOME/git/qwen-code-pr12894 o5a
run "R2-4: A's tool session released, Workspace then held by another holder (after)" TAG=r15rd2 ST=s52 MODE=busy-released
say "## done"
