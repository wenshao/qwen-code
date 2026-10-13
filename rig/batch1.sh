#!/bin/bash
cd /Users/wenshao/git/pr13974-arms
( rig/run-probe.sh head-p3a head $PWD/m2-head p3aDecisionCommittedContinuationLost
  rig/run-probe.sh head-p3c head $PWD/m2-head p3cDecisionInUserTurnContinuationLost
  rig/run-probe.sh head-p3w head $PWD/m2-head p3wWakeTurnContinuationLost ) > logs/batch1-head.out 2>&1 &
( rig/run-probe.sh base-p3w base $PWD/m2-base p3wWakeTurnContinuationLost ) > logs/batch1-base.out 2>&1 &
wait
echo BATCH1_DONE
