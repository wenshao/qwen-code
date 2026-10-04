#!/bin/bash
# usage: batch.sh <scenario...>; runs are serial, results in out/runs/<label>/
RIG=/Users/wenshao/pr13366-rig; cd $RIG
r() { ./run.sh "$@" > /dev/null; L=$2; echo "$(date +%T) $L $(grep -o 'exit=[0-9]* wall=[0-9]*s' out/runs/$L/run.log)"; }
for S in "$@"; do case $S in
  core) for i in 1 2 3 4 5; do for A in base head merge; do RIG_TAP=1 RIG_SCENARIO=core r $A core-$A-$i rig; done; done ;;
  issue) for i in 1 2; do for A in base head merge; do r $A issue-$A-$i x5; done; done ;;
  three) for i in 1 2 3; do for A in head merge; do RIG_TAP=1 RIG_SCENARIO=three RIG_ORDER=A,B,C r $A three-$A-$i rig; done; done; RIG_TAP=1 RIG_SCENARIO=three RIG_ORDER=A,B,C r base three-base-1 rig ;;
  long) for i in 1 2; do for A in head merge; do RIG_TAP=1 RIG_SCENARIO=long RIG_HOLD_A_MS=30000 RIG_FIRST_B_MS=3000 r $A long-$A-$i rig; done; done; RIG_TAP=1 RIG_SCENARIO=long RIG_HOLD_A_MS=30000 RIG_FIRST_B_MS=3000 r base long-base-1 rig ;;
  cancelq) for i in 1 2; do for A in head merge; do RIG_TAP=1 RIG_SCENARIO=cancel-queued RIG_HOLD_A_MS=30000 RIG_FIRST_B_MS=3000 RIG_CANCEL=B@12000 RIG_FOLLOWUP=B r $A cancelq-$A-$i rig; done; done ;;
  deadline) for i in 1 2; do RIG_TAP=1 RIG_SCENARIO=deadline RIG_ORDER=B,A RIG_GAP_MS=3000 RIG_FIRST_B_MS=8000 RIG_HOLD_A_MS=60000 RIG_FOLLOWUP=B RIG_SPRING_ENV_JSON='{"QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE":"20s"}' r merge deadline-merge-$i rig; done ;;
  holdercancel) for i in 1 2; do for A in head merge; do RIG_TAP=1 RIG_SCENARIO=holder-cancel RIG_HOLD_A_MS=40000 RIG_FIRST_B_MS=3000 RIG_CANCEL=A@10000 r $A holdercancel-$A-$i rig; done; done ;;
  holderfail) for i in 1 2; do for A in head merge; do RIG_TAP=1 RIG_SCENARIO=holder-fail RIG_HOLD_A_MS=8000 RIG_FIRST_B_MS=3000 RIG_FINAL_ERROR_A=1 r $A holderfail-$A-$i rig; done; done ;;
  *) echo "unknown scenario $S" ;;
esac; done
echo "$(date +%T) BATCH-DONE $*"
