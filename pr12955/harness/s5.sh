#!/bin/bash
# S5: boot the real jar with the opt-in and one missing prerequisite at a time.
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad; R=$SP/rig
ARM=${ARM:-pr}; OUT=$R/out/s5-$ARM.tsv; : > $OUT
run() { # name files extra...
  local name=$1 files=$2; shift 2
  local log=$SP/logs/s5-$ARM-$name.log
  FILES=$files STORAGES="${ST-a b}" $R/spring.sh $ARM g0s5 "$@" > $log 2>&1 &
  local pid=$! verdict=timeout
  for i in $(seq 1 240); do
    if grep -q "Started ManagedAgentServerApplication" $log; then verdict=STARTED; break; fi
    if ! kill -0 $pid 2>/dev/null; then verdict=EXITED; break; fi
    sleep 0.5
  done
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  local msg=$(grep -o "Hosted Workspace files require[^\"]*" $log | head -1)
  echo -e "$name\tfiles=$files\t$verdict\t$msg" | tee -a $OUT
}
run all-prereqs true
HARNESS=false run harness-disabled true
STORE=false run store-disabled true
BROKER=false run broker-disabled true
run approval-default true --qwen.managed-agent.harness.approval-mode=default
run isolation-workspace true --qwen.managed-agent.runtime-broker.isolation-class=workspace
ST="" run no-mounts true
HARNESS=false run harness-disabled-optout false
ST="" run no-mounts-optout false
