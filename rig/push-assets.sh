#!/bin/bash
# Builds one commit (parent = origin/main) holding the figures, rig and results; pushes it as assets-pr13974.
set -euo pipefail
BASE=/Users/wenshao/git/pr13974-arms
REPO=/Users/wenshao/git/qwen-code
export GIT_INDEX_FILE=$BASE/assets.index
rm -f "$GIT_INDEX_FILE"
git -C $REPO read-tree --empty
n=0
add() { local src=$1 dst=$2; local b; b=$(git -C $REPO hash-object -w "$src"); git -C $REPO update-index --add --cacheinfo 100644,"$b","$dst"; n=$((n+1)); }
for f in $BASE/figs/0*.png; do add "$f" "pr13974/$(basename "$f")"; done
for f in $BASE/rig/*; do [ -f "$f" ] && add "$f" "rig/$(basename "$f")"; done
add $BASE/logs/mutants.jsonl rig/mutants.jsonl
while IFS= read -r f; do add "$f" "results/${f#$BASE/results/}"; done < <(find $BASE/results -name '*.json' | sort)
T=$(git -C $REPO write-tree)
P=$(git -C $REPO rev-parse origin/main | tr -d '[:space:]')
C=$(printf 'PR 13974 real-stack verification evidence\n' | git -C $REPO commit-tree "$T" -p "$P" | tr -d '[:space:]')
[ ${#C} -eq 40 ] || { echo "bad commit"; exit 1; }
cnt=$(git -C $REPO ls-tree -r --name-only "$C" | wc -l | tr -d ' ')
[ "$cnt" -eq "$n" ] || { echo "file count $cnt != $n"; exit 1; }
echo "commit $C files $cnt parent $P"
REFSPEC="${C}:refs/heads/assets-pr13974"
case "$REFSPEC" in [0-9a-f]*:refs/heads/assets-pr13974) ;; *) echo "bad refspec $REFSPEC"; exit 1;; esac
git -C $REPO push wenshao "$REFSPEC" 2>&1 | tail -3
echo "$C" > $BASE/assets.commit
