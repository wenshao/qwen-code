#!/bin/bash
# run-mutants.sh <ts|java> : baseline + every mutant of that family
FAM=$1
S=$SCRATCH
TS=$S/wt-mut; JV=$S/wt-mut/packages/sdk-java
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
MVN="mvn -B -Dgpg.skip -Dmaven.repo.local=$S/m2"
CLI_TESTS="src/serve/hosted-mcp-session.test.ts src/serve/managed-mcp-routes.test.ts src/serve/managed-mcp-runtime.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts"
run_group() { # group log
  case $1 in
    ts) (cd $TS/packages/cli && npx vitest run $CLI_TESTS > $2 2>&1) ;;
    server) (cd $JV/managed-agent-server && $MVN test > $2 2>&1) ;;
    broker) (cd $JV/runtime-broker && $MVN test '-Dtest=*Test,!HttpRuntimeTransportTest#closesTheConnectionOnTheDeadlineAndOnCallerCancel' -Dsurefire.failIfNoSpecifiedTests=false > $2 2>&1) ;;
  esac
  echo $?
}
verdict() { # group rc log
  if [ "$2" = 0 ]; then echo SURVIVED; return; fi
  if [ "$1" = ts ]; then grep -qE '^ +Tests +[0-9]+ failed' $3 && echo KILLED || echo "KILLED(error)"; else
    grep -qE 'COMPILATION ERROR' $3 && echo "KILLED(compile)" || { grep -qE 'Tests run: [0-9]+, Failures: [1-9]|Tests run: [0-9]+, Failures: [0-9]+, Errors: [1-9]' $3 && echo KILLED || echo "KILLED(other)"; }; fi
}
if [ "$FAM" = ts ]; then GROUPS_="ts"; IDS=$(node -e "console.log(require('$S/rig/mutants.cjs').filter(m=>m.group==='ts').map(m=>m.id).join(' '))"); else GROUPS_="server broker"; IDS=$(node -e "console.log(require('$S/rig/mutants.cjs').filter(m=>m.group!=='ts').map(m=>m.id).join(' '))"); fi
for g in $GROUPS_; do rc=$(run_group $g $S/mut/baseline-$g.log); echo "BASELINE $g rc=$rc $(grep -E '^ +Tests +|Tests run: [0-9]+, Fail' $S/mut/baseline-$g.log | tail -1)"; done
for id in $IDS; do
  g=$(node -e "console.log(require('$S/rig/mutants.cjs').find(m=>m.id==='$id').group)")
  node $S/rig/mutate.cjs $TS $JV $id > /dev/null || { echo "$id APPLY_FAILED"; continue; }
  rc=$(run_group $g $S/mut/$id.log)
  node $S/rig/mutate.cjs $TS $JV $id restore
  echo "$id $g $(verdict $g $rc $S/mut/$id.log) $(grep -E '^ +Tests +|Tests run: [0-9]+, Fail' $S/mut/$id.log | tail -1 | sed 's/^ *//')"
done
echo DONE
