#!/bin/bash
cd /rig
mkdir -p /rig/runs
run() { local label=$1 script=$2 args=$3; shift 3
  echo "=== $(date +%T) $label sha=$(cat /rig/HEAD_SHA | cut -c1-10)" >> /rig/matrix.log
  node /rig/abdrive.mjs --label "$label" --out /rig/runs --tsx node --direct 1 --cwd /rig --script "$script" --args "$args" "$@" >> /rig/matrix.log 2>&1
}
H=scripts/run-head.mjs; B=scripts/run-base.mjs
run L1-session-failover $H "--session-failover"
run L2-inflight-failover $H "--inflight-failover"
run L3-continuation-failover $H "--continuation-failover"
run L4-big-output $H "--big-output"
run L5-session-failover-harness-only $H "--session-failover --harness-only"
run L6-inflight-failover-harness-only $H "--inflight-failover --harness-only"
run L7-continuation-failover-harness-only $H "--continuation-failover --harness-only"
run L8-continuation-failover-freeze $H "--continuation-failover --freeze"
run X1-killed-spring-base $B "--inflight-failover" --trigger kill-spring-at-inflight --kill-after 300
run X1-killed-spring-head $H "--inflight-failover" --trigger kill-spring-at-inflight --kill-after 300
run X2-killed-spring-base $B "--inflight-failover" --trigger kill-spring-at-inflight --kill-after 300
run X2-killed-spring-head $H "--inflight-failover" --trigger kill-spring-at-inflight --kill-after 300
echo "=== $(date +%T) linux matrix done" >> /rig/matrix.log
