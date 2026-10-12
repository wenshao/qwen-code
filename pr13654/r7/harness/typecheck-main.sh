#!/bin/bash
# Round 7 control: the same cli typecheck on main e9789d09 with the same (stale, 876b00ef-built) core dist, then restore the PR head.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad
W=$HOME/git/qwen-code-pr13654-merge; cd $W || exit 1; [ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 1; }
git checkout -q --detach e9789d091133d9753decfc139df64c935a1866e6 || exit 1
echo "typecheck at $(git rev-parse --short HEAD) $(date +%T)"
(cd packages/cli && npx tsc --noEmit > $S/r7/results/typecheck-cli-main.log 2>&1; echo "cli tsc exit=$? errors=$(grep -c 'error TS' $S/r7/results/typecheck-cli-main.log) $(date +%T)")
git checkout -q --detach 876b00efba7ea6313993ce1b3646750a2fe6a0da; echo "restored: $(git rev-parse --short HEAD) dirty=[$(git status --porcelain)]"
diff <(grep 'error TS' $S/r7/results/typecheck-cli-main.log) <(grep 'error TS' $S/r7/results/typecheck-cli-merge.log) > /dev/null && echo "error lines identical on main and on the trial merge" || echo "error lines DIFFER"
