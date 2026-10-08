#!/bin/bash
cd /rig
run() { local label=$1 script=$2 args=$3; shift 3
  echo "=== $(date +%T) $label sha=$(cat /rig/HEAD_SHA | cut -c1-10)" >> /rig/matrix.log
  node /rig/abdrive.mjs --label "$label" --out /rig/runs --tsx node --direct 1 --cwd /rig --script "$script" --args "$args" "$@" >> /rig/matrix.log 2>&1
}
H=scripts/run-head.mjs; B=scripts/run-base.mjs
for i in 3 4; do
  run X$i-spring-killed-after-hold-base $B "--inflight-failover" --trigger kill-spring-after-hold --kill-after 300
  run X$i-spring-killed-after-hold-head $H "--inflight-failover" --trigger kill-spring-after-hold --kill-after 300
done
echo "=== $(date +%T) linux x done" >> /rig/matrix.log
