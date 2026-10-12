#!/bin/bash
# Round 7: hosted-never-started-reconcile.test.ts alone, 3 runs per arm (A head, B main, C trial merge, D trial merge with main's copy of the file).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad
W=$HOME/git/qwen-code-pr13654-merge; OUT=$S/r7/results/reconcile-repeat; mkdir -p $OUT
HEAD_SHA=876b00efba7ea6313993ce1b3646750a2fe6a0da; MAIN=e9789d091133d9753decfc139df64c935a1866e6; MERGE=74bab6a50fce22a8cea1ebb08403d4ed99e4c675
T=src/serve/hosted-never-started-reconcile.test.ts
cd $W || exit 1; [ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 1; }
run() { for i in 1 2 3; do
  (cd packages/cli && npx vitest run $T --reporter=verbose > $OUT/$1-$i.log 2>&1); rc=$?
  echo "arm $1 run $i at $(git rev-parse --short HEAD) [$(git status --porcelain | tr -d '\n')] exit=$rc $(grep -E '^ *Tests ' $OUT/$1-$i.log | tr -s ' ') | $(grep -E '^ *(✓|×) .*production kind gate' $OUT/$1-$i.log | sed -E 's/ [0-9]+ms$//; s/^ *//; s/src\/serve\/hosted-never-started-reconcile.test.ts > reconcileNeverStartedChildRuns > //')"
done; }
git checkout -q --detach $HEAD_SHA && run A
git checkout -q --detach $MAIN && run B
git checkout -q --detach $MERGE && run C
git checkout -q $MAIN -- packages/cli/$T && run D
git checkout -q $MERGE -- packages/cli/$T
git checkout -q --detach $HEAD_SHA
echo "restored: $(git rev-parse --short HEAD) dirty=[$(git status --porcelain)]"
