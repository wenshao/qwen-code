#!/bin/bash
# The PR's own suites and the web-shell typecheck on the trial-merge worktree.  usage: static.sh <worktree> <label>
set -u
RIG=/Users/wenshao/pr13165-rig; W=$RIG/$1; L=$2; O=$RIG/out/static-$L; mkdir -p $O
FILES=$(git -C $W diff --name-only 9478f28731 594a360f52)
cd $W
npx eslint $(echo "$FILES" | grep -E '\.tsx?$') --max-warnings 0 > $O/eslint.log 2>&1; echo "eslint (changed TS files, --max-warnings 0) exit=$?" | tee $O/summary.log
npx prettier --check $FILES > $O/prettier.log 2>&1; echo "prettier --check (6 changed files) exit=$?" | tee -a $O/summary.log
cd $W/packages/web-shell
npx tsc -p tsconfig.json --noEmit > $O/tsc.log 2>&1; echo "tsc --noEmit (web-shell) exit=$?" | tee -a $O/summary.log
npx vitest run --config vitest.config.ts client/components/managed client/components/messages/ToolApproval > $O/vitest-pr.log 2>&1; echo "vitest components/managed + messages/ToolApproval* exit=$?" | tee -a $O/summary.log
echo "STATIC-DONE $(date -u +%T)" | tee -a $O/summary.log
