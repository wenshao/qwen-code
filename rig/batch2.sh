#!/bin/bash
cd /Users/wenshao/git/pr13974-arms
for m in "head-p3u p3uUserTurnContinuationLost" "head-p3b p3bSupersedeSubmitLost" "head-p4 p4RollbackGateOffThenReenable" "head-p5 p5DeleteGateOff" "head-p6 p6ReplayCommittedSubmissionGateOff" "head-p7 p7RollbackToBase"; do
  set -- $m
  rig/run-probe.sh $1 head $PWD/m2-head $2
done > logs/batch2-head.out 2>&1
echo BATCH2_DONE >> logs/batch2-head.out
