#!/bin/bash
S=$SCRATCH; T=$S/wt-mut6; export MUTANTS=$S/rig/mutants-r6.cjs
TESTS="src/serve/hosted-mcp-session.test.ts src/serve/managed-mcp-routes.test.ts src/serve/managed-mcp-runtime.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-workspace-broker.test.ts"
run() { (cd $T/packages/cli && npx vitest run $TESTS > $1 2>&1); echo $?; }
rc=$(run $S/mut/r6-baseline.log); echo "BASELINE rc=$rc $(grep -E '^ +Tests ' $S/mut/r6-baseline.log | sed 's/\x1b\[[0-9;]*m//g')"
for id in Z1 Z2 Z3 Z4 Z5; do
  node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id > /dev/null || { echo "$id APPLY_FAILED"; continue; }
  rc=$(run $S/mut/r6-$id.log); node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id restore
  line=$(grep -E '^ +Tests ' $S/mut/r6-$id.log | sed 's/\x1b\[[0-9;]*m//g;s/^ *//')
  if [ "$rc" = 0 ]; then v=SURVIVED; elif echo "$line" | grep -q failed; then v=KILLED; else v="KILLED(error)"; fi
  echo "$id $v $line"
done; echo DONE
