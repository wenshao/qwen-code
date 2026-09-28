#!/bin/bash
S=$SCRATCH; T=$S/wt-mut3; export MUTANTS=$S/rig/mutants-r3.cjs
TESTS="src/serve/hosted-mcp-session.test.ts src/serve/managed-mcp-routes.test.ts src/serve/managed-mcp-runtime.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-workspace-broker.test.ts"
run() { (cd $T/packages/cli && npx vitest run $TESTS > $1 2>&1); echo $?; }
rc=$(run $S/mut/r3-baseline.log); echo "BASELINE rc=$rc $(grep -E '^ +Tests ' $S/mut/r2-baseline.log | sed 's/\x1b\[[0-9;]*m//g')"
for id in M7 M11 X1 X2 X3 X4 X5 X6 X7 X8 X9 X10 X11; do
  node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id > /dev/null || { echo "$id APPLY_FAILED"; continue; }
  rc=$(run $S/mut/r3-$id.log); node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id restore
  line=$(grep -E '^ +Tests ' $S/mut/r3-$id.log | sed 's/\x1b\[[0-9;]*m//g;s/^ *//')
  if [ "$rc" = 0 ]; then v=SURVIVED; elif echo "$line" | grep -q failed; then v=KILLED; else v="KILLED(error)"; fi
  echo "$id $v $line"
done; echo DONE
