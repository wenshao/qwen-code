#!/bin/bash
# usage: unit-mut.sh <mutant|BASE>  -- run the Hosted/Shell unit suites (TS: cli serve + core managed-runtime; Java: module tests)
source /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad/rig/env.sh
NAME=$1
KIND=ts; [ "$NAME" != BASE ] && KIND=$(node $SP/rig/mutants.cjs kind $NAME)
[ "$NAME" != BASE ] && { node $SP/rig/mutants.cjs apply $NAME wt-unit > /dev/null || exit 2; }
L=$SP/logs/unit-$NAME.log; : > $L
case $KIND in
  ts)
    (cd $SP/wt-unit/packages/cli && npx vitest run --maxWorkers=2 src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-shell-publisher.test.ts src/serve/hosted-workspace-broker.test.ts src/serve/managed-runtime-tool-worker.test.ts src/serve/managed-runtime-tool-v3-routes.test.ts src/serve/hosted-harness-contract.test.ts >> $L 2>&1); R1=$?
    (cd $SP/wt-unit/packages/core && npx vitest run --maxWorkers=2 src/managed-runtime/ >> $L 2>&1); R2=$?
    RC="cli=$R1 core=$R2";;
  store)
    (cd $SP/wt-unit && mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$SP/m2 -f packages/sdk-java/managed-agent-server/pom.xml test >> $L 2>&1); RC="java=$?";;
  broker)
    (cd $SP/wt-unit && mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$SP/m2 -f packages/sdk-java/runtime-broker/pom.xml test >> $L 2>&1); RC="java=$?";;
esac
[ "$NAME" != BASE ] && node $SP/rig/mutants.cjs restore $NAME wt-unit > /dev/null
SUMMARY=$(grep -E "^\s+Tests\s+[0-9]|Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" $L | tr -s ' ' | tr '\n' ';')
FAILED=$(grep -E "^\s+(FAIL|×)|<<< FAIL" $L | head -3 | tr -s ' ' | cut -c1-160 | tr '\n' ';')
echo "UNIT $NAME $RC | $SUMMARY | $FAILED" | tee -a $SP/results/unit-mutants.txt
