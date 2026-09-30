#!/bin/bash
S=<scratch>; T=$S/wt-mut8; export MUTANTS=$S/rig/mutants-r8.cjs; export JAVA_HOME=/opt/homebrew/opt/openjdk@25
export PATH=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
TESTS="src/serve/hosted-mcp-session.test.ts src/serve/managed-mcp-routes.test.ts src/serve/managed-mcp-runtime.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-workspace-broker.test.ts"
run() { case $1 in
  ts) (cd $T/packages/cli && npx vitest run $TESTS > $2 2>&1) ;;
  broker) (cd $T/packages/sdk-java/runtime-broker && mvn -B -Dgpg.skip -Dmaven.repo.local=$S/m2 test > $2 2>&1) ;;
  esac; echo $?; }
summary() { grep -E '^ +Tests |Tests run: [0-9]+, Fail.*Skipped: [0-9]+$' $1 | sed 's/\x1b\[[0-9;]*m//g;s/^ *//' | tail -1; }
for g in ts broker; do rc=$(run $g $S/mut/r8-baseline-$g.log); echo "BASELINE $g rc=$rc $(summary $S/mut/r8-baseline-$g.log)"; done
for id in V1 V2 V3 V4 V5 V6 V7 V8 V9 J11 J12 J13; do
  g=$(node -e "console.log(require('$MUTANTS').find(m=>m.id==='$id').group)")
  node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id > /dev/null || { echo "$id APPLY_FAILED"; continue; }
  rc=$(run $g $S/mut/r8-$id.log); node $S/rig/mutate2.cjs $T $T/packages/sdk-java $id restore
  [ "$rc" = 0 ] && v=SURVIVED || v=KILLED; echo "$id $g $v $(summary $S/mut/r8-$id.log)"
done; echo DONE
