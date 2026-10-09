#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8d1d0002-cbf9-486b-a3c9-1d082c3ea9f3/scratchpad
W=$S/r2/wt
export PATH=/Users/wenshao/Install/jdk21/bin:$PATH
export JAVA_HOME=/Users/wenshao/Install/jdk21
cd $W
H=scripts/run-managed-agent-server-e2e.ts; B=scripts/ab-base-runner.ts
run() { local label=$1 script=$2 args=$3; shift 3
  echo "=== $(date +%T) $label: $(git -C $W rev-parse --short HEAD) dirty=$(git -C $W status --short | grep -v '^?? scripts/ab-' | wc -l | tr -d ' ')" >> $S/r2/matrix.log
  node $S/abdrive.mjs --label "$label" --out $S/r2/runs --tsx $W/node_modules/.bin/tsx --cwd $W --script "$script" --args "$args" "$@" >> $S/r2/matrix.log 2>&1
}
run m1-session-failover $H "--session-failover"
run m2-big-output $H "--big-output"
run m3-session-failover-harness-only $H "--session-failover --harness-only"
run m6-real-model-qwen38max $H "--model qwen3.8-max" --kill-after 600
run c1-mycnf-base $B "--session-failover" --home $S/homes/mycnf --kill-after 240
run c1-mycnf-head $H "--session-failover" --home $S/homes/mycnf
run c5-mylogin-pw-head $H "--session-failover" --home $S/homes/mylogin2
run c4-mysqlpwd-head $H "--session-failover" --mysql-pwd wrongpass
run s1-sigint-teardown-base $B "--session-failover" --trigger sigint-teardown --harness-gen 2 --keep-tmp 1
run s1-sigint-teardown-head $H "--session-failover" --trigger sigint-teardown --harness-gen 2 --keep-tmp 1
run w1-freeze-mysql-at-lease-head $H "--session-failover" --trigger freeze-mysql-at-lease --kill-after 240
run w2-freeze-spring-at-start-head $H "--session-failover" --trigger freeze-spring-at-start --kill-after 240
run w3-freeze-spring-at-listen-head $H "--session-failover" --trigger freeze-spring-at-listen --kill-after 240
run w3b-freeze-spring-at-listen-head $H "--session-failover" --trigger freeze-spring-at-listen --kill-after 240
echo "=== $(date +%T) r2 mac matrix done" >> $S/r2/matrix.log
$S/r2/grants.sh > $S/r2/grants.log 2>&1; echo "GRANTS_EXIT=$?" >> $S/r2/grants.log
