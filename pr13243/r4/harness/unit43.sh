#!/bin/bash
# PR #13243 unit tests on one worktree; exit codes read directly (no pipe).
set -u
W=/Users/wenshao/pr13243-rig/$1; L=$2
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
O=/Users/wenshao/pr13243-rig/out/r43/unit-$L
mkdir -p $O
cd $W/packages/cli
echo "head=$(git rev-parse --short HEAD) node=$(node -v) $(date -u +%T)"
npx vitest run src/serve/managed-hook-runtime.test.ts src/serve/hosted-hook-session.test.ts > $O/focused.txt 2>&1; echo "focused exit=$?"
npx vitest run src/serve/managed-context-worker.test.ts src/serve/managed-hook-routes.test.ts src/serve/managed-runtime-provider-worker.test.ts src/serve/managed-runtime-tool-v3-routes.test.ts src/serve/managed-runtime-file-history.test.ts src/serve/hosted-harness-session.test.ts > $O/consumers.txt 2>&1; echo "consumers exit=$?"
grep -E "Test Files|Tests  " $O/focused.txt $O/consumers.txt
echo "done $(date -u +%T)"
