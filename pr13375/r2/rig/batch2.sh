#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fa427b97-be17-4fef-8cd0-0e8d0787846e/scratchpad
R=$SP/results2
for i in 1 2 3; do
  $SP/run-arm.sh $SP/wt-pr2 scripts/run-managed-agent-server-e2e.ts $R/head-run$i.log -- --big-output
  echo "head-run$i $(tail -1 $R/head-run$i.log | cut -c1-30)"
done
for i in 1 2; do
  $SP/run-arm.sh $SP/wt-base2 scripts/run-managed-agent-server-e2e.probe.ts $R/base-run$i.log PROBE_DIAG=1 -- --big-output
  echo "base-run$i $(tail -1 $R/base-run$i.log | cut -c1-30)"
done
for mode in part-digest part-missing manifest-missing; do
  $SP/run-arm.sh $SP/wt-pr2 scripts/run-managed-agent-server-e2e.probe.ts $R/damage-$mode.log PROBE_DIAG=1 PROBE_CORRUPT=$mode PROBE_OUT=$R -- --big-output
  echo "damage-$mode $(tail -1 $R/damage-$mode.log | cut -c1-30)"
done
echo BATCH_DONE
