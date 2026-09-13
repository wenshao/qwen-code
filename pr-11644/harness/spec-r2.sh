#!/bin/bash
# Round 2: PR's own Playwright specs at head — workspace overview + Git visual scenario (F1).
set -uo pipefail
WT=/root/git/pr11644; O=/root/git/h11644/out/r2; V=$O/visuals
rm -rf $V; mkdir -p $V
cd $WT/packages/web-shell
test -z "$(git -C $WT status --porcelain)" || { echo "worktree dirty, abort"; exit 1; }
nice -n 10 npx playwright test client/e2e/web-shell.workspace-overview.spec.ts --reporter=line > $O/spec-overview.log 2>&1; echo "OVERVIEW EXIT=$?" >> $O/spec-overview.log
WEB_SHELL_VISUALS_OUTPUT_DIR=$V nice -n 10 npx playwright test --config playwright.visuals.config.ts git-branch-picker.spec.ts --reporter=line > $O/spec-visual-git.log 2>&1; echo "VISUAL EXIT=$?" >> $O/spec-visual-git.log
grep -a -E "passed|failed|EXIT=" $O/spec-overview.log $O/spec-visual-git.log
echo "visual screenshots:"; ls -la $V/screenshots 2>/dev/null
rm -rf client/e2e/test-results client/e2e/visuals/.playwright test-results playwright-report
git -C $WT status --short | head -3; echo SPEC-R2-DONE
