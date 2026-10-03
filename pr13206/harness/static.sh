#!/bin/bash
# Static gates and suites on the trial merge (clean worktree, no rig fixtures).  usage: static.sh <worktree> <label>
set -u
RIG=/Users/wenshao/pr13206-rig; W=$RIG/$1; L=$2; O=$RIG/out/static-$L; mkdir -p $O
FILES=$(git -C $W diff --name-only 5130c1a734 HEAD -- '*.ts' '*.tsx' '*.md')
cd $W
npx eslint $(echo "$FILES" | grep -E '\.tsx?$') --max-warnings 0 > $O/eslint-changed.log 2>&1; echo "eslint(changed files, --max-warnings 0) exit=$?" | tee $O/summary.log
npx prettier --check $FILES > $O/prettier.log 2>&1; echo "prettier --check (changed files) exit=$?" | tee -a $O/summary.log
cd $W/packages/web-shell
npx tsc -p tsconfig.json --noEmit > $O/tsc.log 2>&1; echo "tsc --noEmit (web-shell) exit=$?" | tee -a $O/summary.log
npx vitest run --config vitest.config.ts client/components/managed > $O/vitest-managed.log 2>&1; echo "vitest client/components/managed exit=$?" | tee -a $O/summary.log
npx vitest run --config vitest.config.ts > $O/vitest-all.log 2>&1; echo "vitest (whole web-shell) exit=$?" | tee -a $O/summary.log
echo "STATIC-DONE $(date -u +%T)" | tee -a $O/summary.log
