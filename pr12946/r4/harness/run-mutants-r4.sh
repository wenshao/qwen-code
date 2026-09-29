#!/bin/bash
S=$SCRATCH; T=$S/wt-mut4; export MUTANTS=$S/rig/mutants-r4.cjs; export JAVA_HOME=/opt/homebrew/opt/openjdk@25
run() { # group log
  if [ "$1" = ts ]; then (cd $T/packages/cli && npx vitest run src/serve/hosted-workspace-broker.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-mcp-session.test.ts src/serve/hosted-harness-session.test.ts > $2 2>&1); else (cd $T/packages/sdk-java/runtime-broker && mvn -B -Dgpg.skip -Dmaven.repo.local=$S/m2 test '-Dtest=*Test,!HttpRuntimeTransportTest#closesTheConnectionOnTheDeadlineAndOnCallerCancel' -Dsurefire.failIfNoSpecifiedTests=false > $2 2>&1); fi; echo $?; }
for g in ts broker; do rc=$(run $g $S/mut/r4-baseline-$g.log); echo "BASELINE $g rc=$rc $(grep -E '^ +Tests |Tests run: [0-9]+, Fail' $S/mut/r4-baseline-$g.log | sed 's/\x1b\[[0-9;]*m//g' | tail -1)"; done
for id in Y1 Y2 Y3 Y4; do
  g=$(node -e "console.log(require('$MUTANTS').find(m=>m.id==='$id').group)")
  node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id > /dev/null || { echo "$id APPLY_FAILED"; continue; }
  rc=$(run $g $S/mut/r4-$id.log); node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id restore
  line=$(grep -E '^ +Tests |Tests run: [0-9]+, Fail' $S/mut/r4-$id.log | sed 's/\x1b\[[0-9;]*m//g;s/^ *//' | tail -1)
  failed=$(grep -oE '[A-Za-z]+Test\.[A-Za-z]+ -- Time|✗ .*|FAIL .*>' $S/mut/r4-$id.log | head -2 | tr '\n' ' ')
  [ "$rc" = 0 ] && v=SURVIVED || v=KILLED; echo "$id $g $v $line :: $failed"
done; echo DONE
