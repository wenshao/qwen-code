#!/bin/bash
cd /root/verify/pr9466/harness
run() { local name=$1 arm=$2; shift 2; env ARM=$arm "$@" timeout 420 ./node_modules/.bin/tsx $name > /root/verify/pr9466/runs/rerun-$name-$arm-$LEGACY.log 2>&1; echo "$name $arm legacy=${LEGACY:-0} exit=$?"; }
for arm in head base; do
  LEGACY=0 run s1-notification.mts $arm
  LEGACY=0 run s2-resume.mts $arm
  LEGACY=0 run s6-fork.mts $arm
  LEGACY=0 run s4-retry.mts $arm
  LEGACY=0 run s3-restore.mts $arm
  LEGACY=0 run s5-compress.mts $arm FAKE_PROMPT_TOKENS=40000
done
LEGACY=1 run s3-restore.mts head LEGACY=1
echo EXIT=done
