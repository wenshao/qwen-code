#!/bin/bash
# Round 15, R2-4: resume while the Workspace is busy, before and after e177e1da.
R=$(cd $(dirname $0); pwd); TSX=/Users/wenshao/git/qwen-code-pr12894/node_modules/.bin/tsx
LOG=$R/out/r15-r24d.log; : > $LOG
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
arm after pr15 $HOME/git/qwen-code-pr12894 o5a
export JAR=pr15 WT=$HOME/git/qwen-code-pr12894
run "local capture path: Broker restarted after the crash (after)" TAG=r15rf1 ST=s57 MODE=restart LOCAL=1 KILL_AT=ack
say "lease after: $(DB=o5a $R/sql.sh -N -B -e "SELECT COALESCE(LEFT(holder_key,12),'NULL') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-s57'),256)")"
say "## done"
