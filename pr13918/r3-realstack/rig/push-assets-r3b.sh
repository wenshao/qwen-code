#!/bin/bash
# Round 3b: replace/add pr13918/r3-realstack/* on top of c6196e60 (round-3 evidence), keeping pr13918/r3/* (another session) untouched.
set -euo pipefail
REPO=/Users/wenshao/git/qwen-code-x3
STAGE=/Users/wenshao/pr13918-rig/assets-stage
BR=assets-pr13918
URL=https://github.com/wenshao/qwen-code.git
cd "$REPO"
TIP=$(git ls-remote "$URL" "refs/heads/$BR" | cut -f1 | tr -d '[:space:]')
[ ${#TIP} -eq 40 ] || { echo "no remote tip"; exit 1; }
[ "$TIP" = "cd132422dfd3f72852907320326499e883b35292" ] || { echo "remote tip $TIP is not the expected cd132422; abort"; exit 1; }
git cat-file -e "$TIP^{commit}" 2>/dev/null || git fetch -q "$URL" "refs/heads/$BR"
git cat-file -e "$TIP^{commit}"
export GIT_INDEX_FILE=/Users/wenshao/pr13918-rig/assets-r3b.index
rm -f "$GIT_INDEX_FILE"
git read-tree "$TIP^{tree}"
BEFORE=$(git ls-files | wc -l | tr -d ' ')
ADDED=0
while IFS= read -r -d '' f; do
  blob=$(git hash-object -w "$STAGE/$f")
  git cat-file -e "$TIP:$f" 2>/dev/null || ADDED=$((ADDED+1))
  git update-index --add --cacheinfo "100644,${blob},${f}"
done < <(cd "$STAGE" && { find pr13918/r3-realstack -type f -print0; } | sort -z)
T=$(git write-tree)
[ "$T" != "$(git rev-parse "$TIP^{tree}")" ] || { echo "tree unchanged"; exit 1; }
C=$(GIT_AUTHOR_NAME=wenshao GIT_COMMITTER_NAME=wenshao git commit-tree "$T" -p "$TIP" -m "PR #13918 real-stack re-verification round 3: re-run on head 72a7897843" | tr -d '[:space:]')
[ ${#C} -eq 40 ]
CNT=$(git ls-tree -r --name-only "$C" | wc -l | tr -d ' ')
[ "$CNT" -eq $((BEFORE + ADDED)) ] || { echo "file count $CNT != $BEFORE + $ADDED"; exit 1; }
for f in pr13918/r3/01-head-arm-all-green.png pr13918/r3/02-base-arm-wedge-red.png pr13918/r3/03-mutation-matrix.png pr13918/r3/04-ts-gates-flake-remeasure.png; do [ "$(git rev-parse "$C:$f")" = "$(git rev-parse "$TIP:$f")" ] || { echo "would change $f"; exit 1; }; done
echo "parent=$TIP tree=$T commit=$C files=$CNT (new $ADDED)"
REFSPEC="${C}:refs/heads/${BR}"
case "$REFSPEC" in [0-9a-f]*:refs/heads/assets-pr13918) ;; *) echo "bad refspec $REFSPEC"; exit 1;; esac
git push "$URL" "$REFSPEC"
echo "$C" > /Users/wenshao/pr13918-rig/assets-commit-r3b.txt
git ls-remote "$URL" "refs/heads/$BR"
