#!/bin/bash
# Static gates the PR description says were not run locally.  usage: static.sh <worktree> <label>
set -u
RIG=/Users/wenshao/pr13107-rig; W=$RIG/$1; L=$2; O=$RIG/out/static-$L; mkdir -p $O
FILES=$(git -C $RIG/wt3 diff --name-only 78143fe335 e572cd72fc)
cd $W
npx eslint $FILES --max-warnings 0 > $O/eslint-changed.log 2>&1; echo "eslint(changed files, --max-warnings 0) exit=$?" | tee $O/summary.log
npx prettier --check $FILES > $O/prettier.log 2>&1; echo "prettier --check (changed files) exit=$?" | tee -a $O/summary.log
cd $W/packages/web-shell
npx tsc -p tsconfig.json --noEmit > $O/tsc.log 2>&1; echo "tsc --noEmit (web-shell) exit=$?" | tee -a $O/summary.log
npx vitest run --config vitest.config.ts client/components/managed > $O/vitest-managed.log 2>&1; echo "vitest client/components/managed exit=$?" | tee -a $O/summary.log
npm run build > $O/build-web-shell.log 2>&1; echo "npm run build (web-shell: app + lib + transcript + types) exit=$?" | tee -a $O/summary.log
npx vitest run --config vitest.config.ts > $O/vitest-all.log 2>&1; echo "vitest (whole web-shell) exit=$?" | tee -a $O/summary.log
echo "STATIC-DONE $(date -u +%T)" | tee -a $O/summary.log
