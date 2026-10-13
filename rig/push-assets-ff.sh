#!/bin/bash
# Fast-forwards assets-pr13974: rebuilds the full tree, parent = the current remote tip (must equal assets.commit).
set -euo pipefail
BASE=/Users/wenshao/git/pr13974-arms
REPO=/Users/wenshao/git/qwen-code
PREV=$(tr -d '[:space:]' < $BASE/assets.commit)
TIP=$(git ls-remote https://github.com/wenshao/qwen-code.git refs/heads/assets-pr13974 | cut -f1 | tr -d '[:space:]')
[ "$TIP" = "$PREV" ] || { echo "remote tip $TIP != $PREV"; exit 1; }
git -C $REPO cat-file -e "${PREV}^{commit}"
export GIT_INDEX_FILE=$BASE/assets.index
rm -f "$GIT_INDEX_FILE"
git -C $REPO read-tree "$PREV"
n=0
add() { local b; b=$(git -C $REPO hash-object -w "$1"); git -C $REPO update-index --add --cacheinfo 100644,"$b","$2"; n=$((n+1)); }
for f in $BASE/figs/0*.png; do add "$f" "pr13974/$(basename "$f")"; done
for f in $BASE/rig/*; do [ -f "$f" ] && add "$f" "rig/$(basename "$f")"; done
add $BASE/logs/mutants.jsonl rig/mutants.jsonl
while IFS= read -r f; do add "$f" "results/${f#$BASE/results/}"; done < <(find $BASE/results \( -name '*.json' -o -name '*.txt' \) | sort)
T=$(git -C $REPO write-tree)
[ "$T" != "$(git -C $REPO rev-parse "${PREV}^{tree}")" ] || { echo "tree unchanged"; exit 1; }
C=$(printf 'PR 13974 verification evidence: P3D and refreshed figures\n' | git -C $REPO commit-tree "$T" -p "$PREV" | tr -d '[:space:]')
[ ${#C} -eq 40 ] || { echo "bad commit"; exit 1; }
git -C $REPO merge-base --is-ancestor "$PREV" "$C"
echo "commit $C added/updated $n; changed: $(git -C $REPO diff --name-only "$PREV" "$C" | wc -l | tr -d ' ')"
git -C $REPO diff --name-only "$PREV" "$C"
REFSPEC="${C}:refs/heads/assets-pr13974"
case "$REFSPEC" in [0-9a-f]*:refs/heads/assets-pr13974) ;; *) echo "bad refspec"; exit 1;; esac
git -C $REPO push wenshao "$REFSPEC" 2>&1 | tail -2
echo "$C" > $BASE/assets.commit
