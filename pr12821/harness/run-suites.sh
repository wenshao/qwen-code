#!/bin/sh
# run-suites.sh <worktree> <label>
WT=$1; L=$2; O=$(dirname "$0")/out
{
echo "== $L head=$(git -C $WT rev-parse --short HEAD) dirty=$(git -C $WT status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
cd $WT/packages/core && npx vitest run --coverage.enabled=false src/managed-runtime/local-shell-result-capture.test.ts src/managed-runtime/local-shell-result-session.test.ts src/services/shellExecutionService.test.ts src/tools/shell.test.ts 2>&1 | grep -E "Test Files|Tests |FAIL|×" | head -8
cd $WT/packages/cli && npx vitest run --coverage.enabled=false src/serve/managed-runtime-tool-v3-routes.test.ts src/serve/managed-context-worker.test.ts src/serve/managed-runtime-tool-worker.test.ts src/serve/managed-runtime-attestation-worker.test.ts 2>&1 | grep -E "Test Files|Tests |FAIL|×" | head -8
echo "== end $L head=$(git -C $WT rev-parse --short HEAD)"
} > $O/suites-$L.txt 2>&1
