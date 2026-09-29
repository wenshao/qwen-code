#!/bin/bash
S=<scratch>; T=$S/wt-mut7; export MUTANTS=$S/rig/mutants-r7.cjs; export JAVA_HOME=/opt/homebrew/opt/openjdk@25
TESTS="src/serve/hosted-mcp-session.test.ts src/serve/managed-mcp-routes.test.ts src/serve/managed-mcp-runtime.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-workspace-broker.test.ts"
run() { if [ "$1" = ts ]; then (cd $T/packages/cli && npx vitest run $TESTS > $2 2>&1); else (cd $T/packages/sdk-java/managed-agent-server && mvn -B -Dgpg.skip -Dmaven.repo.local=$S/m2 test > $2 2>&1); fi; echo $?; }
for g in ts server; do rc=$(run $g $S/mut/r7-baseline-$g.log); echo "BASELINE $g rc=$rc $(grep -E '^ +Tests |Tests run: [0-9]+, Fail.*Skipped: [0-9]+$' $S/mut/r7-baseline-$g.log | sed 's/\x1b\[[0-9;]*m//g' | tail -1)"; done
for id in W1 W3 W5 J9 J10; do
  g=$(node -e "console.log(require('$MUTANTS').find(m=>m.id==='$id').group)")
  node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id > /dev/null || { echo "$id APPLY_FAILED"; continue; }
  rc=$(run $g $S/mut/r7-$id.log); node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id restore
  line=$(grep -E '^ +Tests |Tests run: [0-9]+, Fail.*Skipped: [0-9]+$' $S/mut/r7-$id.log | sed 's/\x1b\[[0-9;]*m//g;s/^ *//' | tail -1)
  [ "$rc" = 0 ] && v=SURVIVED || v=KILLED; echo "$id $g $v $line"
done; echo DONE
