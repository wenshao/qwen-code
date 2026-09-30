#!/bin/bash
S=<scratch>; T=$S/wt-mut8b; export MUTANTS=$S/rig/mutants-r8b.cjs; export JAVA_HOME=/opt/homebrew/opt/openjdk@25
export PATH=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
TESTS="src/serve/hosted-mcp-session.test.ts src/serve/managed-mcp-routes.test.ts src/serve/managed-mcp-runtime.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-workspace-broker.test.ts"
run() { case $1 in
  ts) (cd $T/packages/cli && npx vitest run $TESTS > $2 2>&1) ;;
  broker) (cd $T/packages/sdk-java/runtime-broker && mvn -B -Dgpg.skip -Dmaven.repo.local=$S/m2 test > $2 2>&1) ;;
  esac; echo $?; }
summary() { grep -E '^ +Tests |Tests run: [0-9]+, Fail.*Skipped: [0-9]+$' $1 | sed 's/\x1b\[[0-9;]*m//g;s/^ *//' | tail -1; }
for g in ts; do rc=$(run $g $S/mut/r8b-baseline-$g.log); echo "BASELINE $g rc=$rc $(summary $S/mut/r8b-baseline-$g.log)"; done
for id in P1 P2 P3 P4 P5 P6; do
  g=$(node -e "console.log(require('$MUTANTS').find(m=>m.id==='$id').group)")
  node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id > /dev/null || { echo "$id APPLY_FAILED"; continue; }
  rc=$(run $g $S/mut/r8b-$id.log); node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id restore
  [ "$rc" = 0 ] && v=SURVIVED || v=KILLED; echo "$id $g $v $(summary $S/mut/r8b-$id.log)"
done; echo DONE
