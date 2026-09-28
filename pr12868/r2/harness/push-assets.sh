#!/bin/bash
# Builds one commit (parent: upstream main) holding pr12868/** and pushes it to
# the wenshao fork as assets-pr12868. Never touches HEAD or any work tree.
set -euo pipefail
SCRATCH=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/bf547e10-456d-4aa7-8960-aef6c60a0195/scratchpad
REPO=/Users/wenshao/git/qwen-code-x3
PARENT=3f5ae3ffeb7264f236038eef91256a3310361d3c
cd "$REPO"
if git ls-remote --heads https://github.com/wenshao/qwen-code.git assets-pr12868 | grep -q .; then
  echo "remote branch assets-pr12868 already exists; refusing to overwrite"; exit 2
fi
export GIT_INDEX_FILE="$SCRATCH/assets.index"
rm -f "$GIT_INDEX_FILE"
git read-tree --empty
cd "$SCRATCH/assets"
find pr12868 -type f | sort | while read -r f; do
  blob=$(git -C "$REPO" hash-object -w "$SCRATCH/assets/$f")
  mode=100644; case "$f" in *.sh) mode=100755;; esac
  git -C "$REPO" update-index --add --cacheinfo "$mode,$blob,$f"
done
cd "$REPO"
TREE=$(git write-tree)
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "PR #12868 evidence: real-stack verification of Broker provider controls" | tr -d "[:space:]")
unset GIT_INDEX_FILE
echo "tree=$TREE commit=$COMMIT files=$(git ls-tree -r --name-only "$COMMIT" -- pr12868 | wc -l | tr -d ' ')"
REFSPEC="${COMMIT}:refs/heads/assets-pr12868"
echo "refspec=$REFSPEC"
git push wenshao "$REFSPEC"
echo "$COMMIT" > "$SCRATCH/assets.commit"
