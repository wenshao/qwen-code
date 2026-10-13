#!/bin/bash
cd /Users/wenshao/git/pr13974-arms
for m in "merge-p3a p3aDecisionCommittedContinuationLost" "merge-p3b p3bSupersedeSubmitLost" "merge-p4 p4RollbackGateOffThenReenable" "merge-p6 p6ReplayCommittedSubmissionGateOff" "merge-p3c p3cDecisionInUserTurnContinuationLost"; do
  set -- $m
  rig/run-probe.sh $1 merge $PWD/m2-merge $2
done > logs/batch3-merge.out 2>&1
echo BATCH3_DONE >> logs/batch3-merge.out
