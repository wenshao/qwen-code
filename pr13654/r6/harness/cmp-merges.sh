#!/bin/bash
# For each merge commit: parents, conflicted paths, paths that differ from the automatic merge, and the hand resolution.
cd $HOME/git/qwen-code-pr13654 || exit 1
for M in "$@"; do
  M=$(git rev-parse $M); P1=$(git rev-parse $M^1); P2=$(git rev-parse $M^2)
  echo "=== merge $M"
  echo "first parent  $P1 ($(git log -1 --format=%s $P1 | cut -c1-70))"
  echo "second parent $P2 on main: $(git merge-base --is-ancestor $P2 origin/main && echo yes || echo NO)"
  T=$(git merge-tree --write-tree $P1 $P2 | head -1)
  C=$(git merge-tree --write-tree --name-only $P1 $P2 | sed -n '2,/^$/p' | sed '/^$/d')
  echo "conflicted paths in a plain merge of the same parents:"; echo "$C" | sed 's/^/   /'
  echo "paths where the merge differs from the automatic merge (conflict markers included):"
  git diff --name-only $T $M | sed 's/^/   /'
  echo "files changed vs first parent: $(git diff --name-only $P1 $M | wc -l | tr -d ' '); vs second parent: $(git diff --name-only $P2 $M | wc -l | tr -d ' ')"
done
