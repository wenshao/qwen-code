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
  modes)
    run m1-session-failover $HEAD_R "--session-failover"
    run m2-big-output $HEAD_R "--big-output"
    run m3-session-failover-harness-only $HEAD_R "--session-failover --harness-only"
    run m4-inflight-failover-harness-only $HEAD_R "--inflight-failover --harness-only"
    run m5-continuation-failover-harness-only $HEAD_R "--continuation-failover --harness-only"
    run m6-real-model-qwen38max $HEAD_R "--model qwen3.8-max" --kill-after 600
    ;;
  creds)
    run c1-mycnf-base $BASE_R "--session-failover" --home $S/homes/mycnf --kill-after 240
    run c1-mycnf-head $HEAD_R "--session-failover" --home $S/homes/mycnf
    run c2-mylogin-base $BASE_R "--session-failover" --home $S/homes/mylogin --kill-after 240
    run c2-mylogin-head $HEAD_R "--session-failover" --home $S/homes/mylogin
    run c2-mylogin-mutant-no-home-isolation $MUT_R "--session-failover" --home $S/homes/mylogin --kill-after 240
    run c3-loginfile-base $BASE_R "--session-failover" --login-file $S/loginfile/dev.mylogin.cnf --kill-after 240
    run c3-loginfile-head $HEAD_R "--session-failover" --login-file $S/loginfile/dev.mylogin.cnf
    run c4-mysqlpwd-base $BASE_R "--session-failover" --mysql-pwd wrongpass --kill-after 240
    run c4-mysqlpwd-head $HEAD_R "--session-failover" --mysql-pwd wrongpass
    ;;
  sigint)
    run s1-sigint-teardown-base $BASE_R "--session-failover" --trigger sigint-teardown --harness-gen 2 --keep-tmp 1
    run s1-sigint-teardown-head $HEAD_R "--session-failover" --trigger sigint-teardown --harness-gen 2 --keep-tmp 1
    run s2-sigint-teardown-base $BASE_R "--session-failover" --trigger sigint-teardown --harness-gen 2 --keep-tmp 1
    run s2-sigint-teardown-head $HEAD_R "--session-failover" --trigger sigint-teardown --harness-gen 2 --keep-tmp 1
    ;;
  wedge)
    run w1-freeze-mysql-at-lease-head $HEAD_R "--session-failover" --trigger freeze-mysql-at-lease --kill-after 240
    run w1-freeze-mysql-at-lease-base $BASE_R "--session-failover" --trigger freeze-mysql-at-lease --kill-after 180
    run w2-freeze-spring-at-start-head $HEAD_R "--session-failover" --trigger freeze-spring-at-start --kill-after 240
    run w2-freeze-spring-at-start-base $BASE_R "--session-failover" --trigger freeze-spring-at-start --kill-after 240
    run w3-freeze-spring-at-listen-head $HEAD_R "--session-failover" --trigger freeze-spring-at-listen --kill-after 240
    run w3-freeze-spring-at-listen-base $BASE_R "--session-failover" --trigger freeze-spring-at-listen --kill-after 420
    ;;
esac
echo "=== $(date +%T) group $1 done" >> $S/matrix.log
