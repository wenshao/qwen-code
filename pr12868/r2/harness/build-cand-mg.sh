#!/bin/bash
SCRATCH=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $SCRATCH/wt-cand || exit 1
echo "cand start=$(date +%T)"
node scripts/setup-worktree.js > $SCRATCH/logs/setup-cand.log 2>&1; echo "setup rc=$?"
npm run build > $SCRATCH/logs/build-cand.log 2>&1; echo "build rc=$?"
npm run bundle > $SCRATCH/logs/bundle-cand.log 2>&1; echo "bundle rc=$?"
(cd packages/cli && npx vitest run src/serve/managed-runtime-provider-worker.test.ts > $SCRATCH/logs/cand-worker-test.log 2>&1); echo "cand worker test rc=$?"
npx prettier --check packages/cli/src/serve/managed-runtime-provider-worker.ts packages/cli/src/serve/managed-runtime-provider-worker.test.ts > $SCRATCH/logs/cand-prettier.log 2>&1; echo "prettier rc=$?"
npx eslint packages/cli/src/serve/managed-runtime-provider-worker.ts packages/cli/src/serve/managed-runtime-provider-worker.test.ts > $SCRATCH/logs/cand-eslint.log 2>&1; echo "eslint rc=$?"
npm run typecheck --workspace=packages/cli > $SCRATCH/logs/cand-typecheck.log 2>&1; echo "typecheck rc=$?"
ls -la dist/cli.js; echo "cand end=$(date +%T)"
$SCRATCH/bin/build-arm.sh mg
