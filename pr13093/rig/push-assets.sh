#!/bin/bash
# Publishes the bundle as one commit on wenshao/qwen-code:assets-pr13093 without
# touching HEAD or the work tree. Parent is an upstream commit so raw URLs
# anchored on the commit SHA resolve. Never force-pushes.
set -euo pipefail
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ca10fe78-f90a-48aa-bd99-da21179043ff/scratchpad
BUNDLE="$1"
BRANCH=assets-pr13093
cd /Users/wenshao/git/qwen-code-x3
REMOTE_TIP=$(git ls-remote --heads https://github.com/wenshao/qwen-code.git "$BRANCH" | cut -f1)
if [ -n "$REMOTE_TIP" ]; then
  git cat-file -e "${REMOTE_TIP}^{commit}" 2>/dev/null || git fetch -q wenshao "$REMOTE_TIP"
  PARENT="$REMOTE_TIP"; BASE_TREE="$REMOTE_TIP"
else
  PARENT=$(git rev-parse origin/main); BASE_TREE=""
fi
export GIT_INDEX_FILE="$S/assets.index.$$"
if [ -n "$BASE_TREE" ]; then git read-tree "$BASE_TREE"; else git read-tree --empty; fi
( cd "$BUNDLE" && find pr13093 -type f | sort ) | while read -r file; do
  blob=$(git hash-object -w "$BUNDLE/$file")
  mode=100644; case "$file" in *.sh) mode=100755 ;; esac
  git update-index --add --cacheinfo "$mode,$blob,$file"
done
TREE=$(git write-tree)
COMMIT=$(GIT_AUTHOR_NAME="$ASSETS_AUTHOR_NAME" GIT_AUTHOR_EMAIL="$ASSETS_AUTHOR_EMAIL" GIT_COMMITTER_NAME="$ASSETS_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$ASSETS_AUTHOR_EMAIL" \
  git commit-tree "$TREE" -p "$PARENT" -m "$2" | tr -d '[:space:]')
unset GIT_INDEX_FILE
[ "${#COMMIT}" -eq 40 ] || { echo "bad commit id: '$COMMIT'"; exit 1; }
git merge-base --is-ancestor "$PARENT" "$COMMIT" || { echo "parent is not an ancestor"; exit 1; }
REFSPEC="${COMMIT}:refs/heads/${BRANCH}"
case "$REFSPEC" in [0-9a-f]*:refs/heads/assets-pr13093) ;; *) echo "refusing refspec '$REFSPEC'"; exit 1 ;; esac
echo "pushing $REFSPEC (parent $PARENT, files $(git ls-tree -r --name-only "$COMMIT" -- pr13093 | wc -l | tr -d ' '))"
git push wenshao "$REFSPEC"
echo "$COMMIT" > "$S/assets-commit.txt"
