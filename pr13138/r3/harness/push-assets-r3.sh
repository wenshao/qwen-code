#!/bin/bash
# macOS host: fast-forward wenshao/qwen-code@assets-pr13138 with the round-3 evidence under pr13138/r3/.
# Plumbing only (own index file); never touches HEAD or a worktree.
set -euo pipefail
RIG=/Users/wenshao/pr13138-rig; REPO=/Users/wenshao/git/qwen-code-x3; BR=assets-pr13138
STAGE=$RIG/stage-r3
rm -rf "$STAGE"; mkdir -p "$STAGE/pr13138/r3"/{results,harness/vm,harness/fig}
P="$STAGE/pr13138/r3"
cp "$RIG"/fig/png-r3/*.png "$P/"
cp "$RIG/assets-README-r3.md" "$P/README.md"
cp "$RIG/cand-r3-model-resource-kinds.patch" "$P/"
cp -R "$RIG/out/e2e-e50" "$P/results/e2e-e50"
cp -R "$RIG/out/e2e-m3" "$P/results/e2e-m3"
cp -R "$RIG/out/unit-java" "$P/results/unit-java"
cp "$RIG"/out/e2e-m3-flyway.txt "$RIG"/out/e2e-m3-e50-flyway.txt "$RIG"/out/unit-java-m3.txt "$RIG"/out/unit-ts-m3-*.log "$RIG"/out/unit-ts-e50c.log "$P/results/"
cp "$RIG"/vm/m3-hooks.mjs "$RIG"/vm/m3-hooks-ab.mjs "$RIG"/vm/m3-cwd.mjs "$RIG"/vm/m3-manifests.mjs "$RIG"/vm/hook-handlers.mjs "$RIG"/vm/m3-flyway.sh "$RIG"/vm/e50-flyway.sh "$RIG"/vm/run-server.sh "$RIG"/vm/r2-matrix.mjs "$RIG"/vm/w1b.mjs "$RIG"/vm/pop.mjs "$P/harness/vm/"
cp "$RIG"/fig/cards-r3.mjs "$RIG"/fig/render.mjs "$P/harness/fig/"
cp "$RIG"/build-jar-multi.sh "$RIG"/unit-java-m3.sh "$RIG"/build-ts.sh "$RIG"/push-assets-r3.sh "$P/harness/"
# Secret scan: the real-OSS credentials still on the VM (not used this round) and the LAN prefix must not appear.
ENVF=/var/lib/qwen-w1b/oss-real.env
AK=$(colima ssh -p pr12869 -- bash -c "[ -f $ENVF ] && . $ENVF && printf %s \"\$OSS_ACCESS_KEY_ID\"" || true)
SK=$(colima ssh -p pr12869 -- bash -c "[ -f $ENVF ] && . $ENVF && printf %s \"\$OSS_ACCESS_KEY_SECRET\"" || true)
BUCKET=$(colima ssh -p pr12869 -- bash -c "[ -f $ENVF ] && . $ENVF && printf %s \"\$OSS_BUCKET\"" || true)
LAN="192.168.0"; LAN="$LAN."
echo "scan strings: ak=${#AK} sk=${#SK} bucket=${#BUCKET} chars"
for s in "$AK" "$SK" "$BUCKET" "$LAN"; do
  [ -n "$s" ] || continue
  if grep -rqF -- "$s" "$STAGE"; then echo "LEAK: a secret/private string is present"; grep -rlF -- "$s" "$STAGE" | head; exit 1; fi
done
if grep -rqE -- "LTA""I[0-9A-Za-z]{12,}" "$STAGE"; then echo "LEAK: an AccessKey ID pattern is present"; exit 1; fi
echo "secret scan clean over $(find "$STAGE" -type f | wc -l | tr -d ' ') files, $(du -sh "$STAGE" | cut -f1)"
cd "$REPO"
TIP=$(git ls-remote wenshao "refs/heads/$BR" | cut -f1 | tr -d '[:space:]')
[ ${#TIP} -eq 40 ] || { echo "remote tip missing"; exit 1; }
git cat-file -e "${TIP}^{commit}" 2>/dev/null || git fetch -q wenshao "$TIP"
git cat-file -e "${TIP}^{commit}"
export GIT_INDEX_FILE="$RIG/.assets-index-r3"; rm -f "$GIT_INDEX_FILE"
git read-tree "$TIP"
( cd "$STAGE" && find pr13138 -type f | sort ) | while read -r f; do
  b=$(git hash-object -w "$STAGE/$f"); git update-index --add --cacheinfo "100644,$b,$f"
done
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p "$TIP" -m "PR 13138 real-environment verification evidence, round 3" | tr -d '[:space:]')
unset GIT_INDEX_FILE
[ ${#C} -eq 40 ] || { echo "bad commit id"; exit 1; }
git merge-base --is-ancestor "$TIP" "$C" || { echo "not a fast-forward"; exit 1; }
REFSPEC="${C}:refs/heads/${BR}"
case "$REFSPEC" in [0-9a-f]*:refs/heads/assets-pr13138) ;; *) echo "bad refspec $REFSPEC"; exit 1;; esac
echo "pushing $REFSPEC (parent $TIP)"
git push wenshao "$REFSPEC" || { sleep 3; git ls-remote wenshao "refs/heads/$BR"; git -c http.postBuffer=524288000 push -v wenshao "$REFSPEC"; }
echo "$C" > "$RIG/assets-commit-r3.txt"
git ls-remote wenshao "refs/heads/$BR"
