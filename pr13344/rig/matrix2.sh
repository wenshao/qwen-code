#!/bin/bash
# Sequential real-stack runs on macOS. JDK 21 first on PATH (CI parity).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8d1d0002-cbf9-486b-a3c9-1d082c3ea9f3/scratchpad
W=$S/wt-head
export PATH=/Users/wenshao/Install/jdk21/bin:$PATH
export JAVA_HOME=/Users/wenshao/Install/jdk21
cd $W
HEAD_R=scripts/run-managed-agent-server-e2e.ts
BASE_R=scripts/ab-base-runner.ts
MUT_R=scripts/ab-mut-no-home-isolation.ts
run() { # label script args [extra driver opts...]
  local label=$1 script=$2 args=$3; shift 3
  echo "=== $(date +%T) $label: $(git -C $W rev-parse --short HEAD) dirty=$(git -C $W status --short | grep -v '^?? scripts/ab-' | wc -l | tr -d ' ')" >> $S/matrix.log
  node $S/abdrive.mjs --label "$label" --out $S/runs --tsx $W/node_modules/.bin/tsx --cwd $W --script "$script" --args "$args" "$@" >> $S/matrix.log 2>&1
}
case "$1" in
  creds2)
    run c5-mylogin-pw-base $BASE_R "--session-failover" --home $S/homes/mylogin2 --kill-after 240
    run c5-mylogin-pw-head $HEAD_R "--session-failover" --home $S/homes/mylogin2
    run c5-mylogin-pw-mutant-no-home-isolation $MUT_R "--session-failover" --home $S/homes/mylogin2 --kill-after 240
    run c6-loginfile-pw-base $BASE_R "--session-failover" --login-file $S/loginfile/dev2.mylogin.cnf --kill-after 240
    run c6-loginfile-pw-head $HEAD_R "--session-failover" --login-file $S/loginfile/dev2.mylogin.cnf
    run c6-loginfile-pw-mutant-no-home-isolation $MUT_R "--session-failover" --login-file $S/loginfile/dev2.mylogin.cnf --kill-after 240
    ;;
  w1again)
    run w1b-freeze-mysql-at-lease-head $HEAD_R "--session-failover" --trigger freeze-mysql-at-lease --kill-after 240
    ;;
esac
echo "=== $(date +%T) group $1 done" >> $S/matrix.log
