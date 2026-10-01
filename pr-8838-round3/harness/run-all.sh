#!/usr/bin/env bash
cd /root/verify/pr8838
pids=()
for s in ok fail retry uretry; do
  for a in base head; do
    bash harness/run.sh $a $s > runs/run-$a-$s.log 2>&1 &
    pids+=($!)
  done
done
for p in "${pids[@]}"; do wait $p; done
for f in runs/run-*.log; do echo "$f: $(grep -E 'RUN_DONE|Error|error' $f | tail -2 | tr '\n' ' ')"; done
