#!/usr/bin/env bash
# Root gates from the PR's Reviewer Test Plan, run on the PR head worktree.
set -u
cd /root/verify/pr12391
L=/root/verify/pr12391-harness/logs
echo "HEAD=$(git rev-parse HEAD)" > $L/root-gates.summary
node --version >> $L/root-gates.summary
t0=$(date +%s)
QWEN_SKIP_PREPARE=1 HUSKY=0 corepack pnpm install --frozen-lockfile > $L/pnpm-install.log 2>&1
echo "pnpm install exit=$? secs=$(( $(date +%s)-t0 ))" >> $L/root-gates.summary
t1=$(date +%s)
npm run build > $L/npm-build.log 2>&1
echo "npm run build exit=$? secs=$(( $(date +%s)-t1 ))" >> $L/root-gates.summary
t2=$(date +%s)
npm run typecheck > $L/npm-typecheck.log 2>&1
echo "npm run typecheck exit=$? secs=$(( $(date +%s)-t2 ))" >> $L/root-gates.summary
echo "git status after: $(git status --porcelain | wc -l) changed paths" >> $L/root-gates.summary
echo EXIT=done >> $L/root-gates.summary
