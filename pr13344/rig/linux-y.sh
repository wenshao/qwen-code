#!/bin/bash
cd /rig
run() { local label=$1 script=$2 args=$3; shift 3
  echo "=== $(date +%T) $label sha=$(cat /rig/HEAD_SHA | cut -c1-10)" >> /rig/matrix.log
  node /rig/abdrive.mjs --label "$label" --out /rig/runs --tsx node --direct 1 --cwd /rig --script "$script" --args "$args" "$@" >> /rig/matrix.log 2>&1
}
H=scripts/run-head.mjs; B=scripts/run-base.mjs
for i in 1 2; do
  run Y$i-freeze-sigint-after-fence-base $B "--continuation-failover --freeze" --trigger sigint-on-stdout --match fencedFormerWriter
  run Y$i-freeze-sigint-after-fence-head $H "--continuation-failover --freeze" --trigger sigint-on-stdout --match fencedFormerWriter
done
echo "=== $(date +%T) linux y done" >> /rig/matrix.log
