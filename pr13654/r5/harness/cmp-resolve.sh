#!/bin/bash
# Compare the bot's resolution commit with a local merge of the same parents (conflict hunk taken from main).
NEW=$1; OLD=569befb8de3cc7d58d0d26a5312b582242e174b9; Y=.github/workflows/sdk-java.yml
cd $HOME/git/qwen-code-pr13654 || exit 1
git fetch -q origin pull/13654/head && [ "$(git rev-parse FETCH_HEAD)" = "$NEW" ] || { echo "fetched head $(git rev-parse FETCH_HEAD) != $NEW"; exit 1; }
echo "new=$NEW parents: $(git log -1 --format=%P $NEW)"; echo "author/committer: $(git log -1 --format='%an <%ae> / %cn <%ce>' $NEW)"; git log -1 --format=%B $NEW | head -20
P1=$(git rev-parse $NEW^1); P2=$(git rev-parse $NEW^2 2>/dev/null)
[ "$P1" = "$OLD" ] && echo "first parent = round-4 head OK" || echo "first parent != round-4 head"
[ -n "$P2" ] && { git merge-base --is-ancestor $P2 origin/main 2>/dev/null || git fetch -q origin main; git merge-base --is-ancestor $P2 origin/main && echo "second parent $P2 is on main" || echo "second parent $P2 NOT on main"; }
T=$(git merge-tree --write-tree $OLD $P2 2>/dev/null | head -1)
echo "conflicted paths in a plain merge of the same parents:"; git merge-tree --write-tree --name-only $OLD $P2 2>/dev/null | sed -n '2,/^$/p' | sed '/^$/d;s/^/   /'
echo "yml in new == yml at second parent: $(git diff --quiet $P2 $NEW -- $Y && echo yes || echo NO)"
echo "paths where new differs from the auto-merged tree (expected: only $Y):"; git diff --name-only $T $NEW | sed 's/^/   /'
echo "PR store/config files identical to round-4 head:"; for f in $(git diff --name-only $(git merge-base $OLD $P2) $OLD -- packages/sdk-java packages/cli/src/serve docs | grep -v README.md); do git diff --quiet $OLD $NEW -- $f || echo "   DIFFERS $f"; done; echo "   (done)"
