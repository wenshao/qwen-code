#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fa427b97-be17-4fef-8cd0-0e8d0787846e/scratchpad
R=$SP/results3
V=scripts/run-managed-agent-server-e2e.probe.ts
run() { local name=$1; shift; $SP/run-arm.sh "$@"; echo "$name $(tail -1 ${3} | cut -c1-30)"; }
for i in 1 2 3; do run head-run$i $SP/wt-pr3 scripts/run-managed-agent-server-e2e.ts $R/head-run$i.log -- --big-output; done
for i in 1 2; do run base-run$i $SP/wt-base3 $V $R/base-run$i.log PROBE_DIAG=1 -- --big-output; done
for i in 1 2 3; do run g3-run$i $SP/wt-pr3 $V $R/g3-run$i.log PROBE_DIAG=1 -- --big-output --harness-only; done
run full-replay $SP/wt-pr3 $V $R/full-replay.log PROBE_DIAG=1 -- --big-output
for mode in part-digest part-missing manifest-missing; do run damage-$mode $SP/wt-pr3 $V $R/damage-$mode.log PROBE_DIAG=1 PROBE_CORRUPT=$mode PROBE_OUT=$R -- --big-output; done
run g3-damage-part-digest $SP/wt-pr3 $V $R/g3-damage-part-digest.log PROBE_DIAG=1 PROBE_CORRUPT=part-digest PROBE_OUT=$R -- --big-output --harness-only
echo BATCH_DONE
