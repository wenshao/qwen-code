#!/bin/bash
# Is the new bwrap-relay.test.ts load-bearing? Run it on the fix tree (expect pass, NOT skipped),
# then revert only bwrap-relay.ts to the parent implementation and re-run (expect RED).
set -o pipefail
R=/root/git/pr12267-r7
V=/root/verify/r7
cd $R/packages/core
REL=src/sandbox/bwrap-relay.ts
echo "=== [1] fix tree: relay test (must PASS, must run on linux not skip) ==="
npx vitest run $REL.test.ts --reporter=basic 2>&1 | grep -E "Test Files|Tests |skipped|passed|failed|✓|✗|×|bwrap relay" | tail -20
echo
echo "=== [2] MUTANT: revert bwrap-relay.ts to parent (keep the test) -> expect RED ==="
cp $REL $V/relay-fix-backup.ts
cp $V/relay-parent.ts $REL
npx vitest run $REL.test.ts --reporter=basic 2>&1 | grep -E "Test Files|Tests |passed|failed|✓|✗|×|Error|chmod|reopen|toMatchObject" | tail -25
echo "--- restore ---"
cp $V/relay-fix-backup.ts $REL
git -C $R diff --stat -- $REL
echo
echo "=== [3] fix tree: broader targeted sandbox suite ==="
npx vitest run src/sandbox/ src/services/shellExecutionService.test.ts --reporter=basic 2>&1 | grep -E "Test Files|Tests " | tail -5
