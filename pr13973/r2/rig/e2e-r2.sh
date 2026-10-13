#!/bin/bash
# usage: mut/e2e-r2.sh <label> [mutant-id]  -- runs the PR's Managed Playwright specs in src-mut (chromium)
R=/Users/wenshao/pr13973-rig; W=$R/src-mut/packages/web-shell; L=$R/out/e2e-r2-$1.log
cd $W
if [ -n "$2" ]; then node $R/mut/apply-r2.mjs $2 || exit 1; fi
PLAYWRIGHT_PORT=5977 NO_PROXY=127.0.0.1,localhost npx playwright test --config playwright.config.ts --project=chromium --reporter=line \
  client/e2e/managed-usability.spec.ts client/e2e/managed-draft-retry.spec.ts client/e2e/managed-workspace-w0d.spec.ts client/e2e/web-shell.managed-progress.spec.ts > $L 2>&1
echo "exit=$?" >> $L
if [ -n "$2" ]; then git -C $R/src-mut checkout -- packages/web-shell/client; fi
pkill -f "vite.*--port 5977" 2>/dev/null
grep -E "passed|failed|flaky|exit=" $L | tail -5
