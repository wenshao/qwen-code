#!/bin/bash
# Round 7: cli typecheck (tsc --noEmit; core is mapped to its sources) on the local trial merge 74bab6a5, then restore the PR head.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad
W=$HOME/git/qwen-code-pr13654-merge; cd $W || exit 1; [ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 1; }
git checkout -q --detach 74bab6a50fce22a8cea1ebb08403d4ed99e4c675 || exit 1
echo "typecheck at $(git rev-parse --short HEAD) $(date +%T)"
(cd packages/cli && npx tsc --noEmit > $S/r7/results/typecheck-cli-merge.log 2>&1; echo "cli tsc exit=$? errors=$(grep -c 'error TS' $S/r7/results/typecheck-cli-merge.log) $(date +%T)")
(cd packages/core && npx tsc --noEmit > $S/r7/results/typecheck-core-merge.log 2>&1; echo "core tsc exit=$? errors=$(grep -c 'error TS' $S/r7/results/typecheck-core-merge.log) $(date +%T)")
git checkout -q --detach 876b00efba7ea6313993ce1b3646750a2fe6a0da; echo "restored: $(git rev-parse --short HEAD) dirty=[$(git status --porcelain)]"
