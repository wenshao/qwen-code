#!/bin/bash
# Round 7: run the shared-test files on four arms in the -merge worktree (detached checkouts, restored to the PR head at the end).
#   A = PR head 876b00ef   B = current main   C = local trial merge (A + B, no conflicts, never pushed)
#   D = C with hosted-never-started-reconcile.test.ts taken from main (i.e. the PR's 876b00ef edit dropped)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad
W=$HOME/git/qwen-code-pr13654-merge; OUT=$S/r7/results/node-arms; mkdir -p $OUT
HEAD_SHA=876b00efba7ea6313993ce1b3646750a2fe6a0da; MAIN=$1; MERGE=$2
T=src/serve/hosted-never-started-reconcile.test.ts
FILES="$T src/serve/hosted-harness-session.test.ts src/serve/remote-shell-result-publication.test.ts"
cd $W || exit 1
[ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 1; }
run() { # $1 arm name
  echo "== arm $1 at $(git rev-parse --short HEAD) $(git status --porcelain | tr '\n' ' ')"
  (cd packages/cli && npx vitest run $FILES --reporter=verbose > $OUT/$1.log 2>&1; echo "vitest exit=$?")
  grep -E "^ *(Test Files|Tests) " $OUT/$1.log
  grep -E "^ *(×|✗|FAIL) " $OUT/$1.log | head -8
}
git checkout -q --detach $HEAD_SHA && run A
git checkout -q --detach $MAIN && run B
git checkout -q --detach $MERGE && run C
git checkout -q $MAIN -- packages/cli/$T && run D
git checkout -q $MERGE -- packages/cli/$T
git checkout -q --detach $HEAD_SHA
echo "restored: $(git rev-parse --short HEAD) dirty=[$(git status --porcelain)]"
