#!/bin/bash
# macOS host: publish the evidence tree to wenshao/qwen-code@assets-pr13138 as one commit whose parent is origin/main
# (so raw.githubusercontent.com resolves the commit SHA). Never touches HEAD or a worktree.
set -euo pipefail
RIG=/Users/wenshao/pr13138-rig; REPO=/Users/wenshao/git/qwen-code-x3; BR=assets-pr13138
STAGE=$RIG/stage-r2
rm -rf "$STAGE"; mkdir -p "$STAGE/pr13138/r2"/{results/e2e-r2,results/e2e-r3,results/console,harness/vm,harness/fig}
P="$STAGE/pr13138/r2"
cp "$RIG"/fig/png-r2/*.png "$P/"
cp "$RIG/assets-README-r2.md" "$P/README.md"
cp "$RIG/cand-r2-criticals.patch" "$P/"
cp "$RIG"/out/e2e-r2/* "$P/results/e2e-r2/"
cp "$RIG"/out/e2e-r3/* "$P/results/e2e-r3/"
cp "$RIG"/out/console/r2-*.console "$RIG"/out/console/r3-*.console "$P/results/console/"
cp "$RIG"/out/unit-r2.log "$RIG"/out/unit-r3.log "$RIG"/out/unit-cand-r2.log "$RIG"/out/unit-cand-r2-on-head.log "$RIG"/out/unit-candtests-on-r3.log "$P/results/"
cp "$RIG"/out/it/r3.log "$P/results/it-r3.log"
cp "$RIG"/vm/r2-matrix.mjs "$RIG"/vm/oddname.mjs "$RIG"/vm/r2-d-old.mjs "$RIG"/vm/w1b.mjs "$RIG"/vm/s8-ab.mjs "$RIG"/vm/run-server.sh "$P/harness/vm/"
cp "$RIG"/fig/cards-r2.mjs "$P/harness/fig/"
cp "$RIG"/run-it.sh "$RIG"/push-assets-r2.sh "$P/harness/"
# Secrets / private names must not leave the machine.
BUCKET=$(tr -d '[:space:]' < "$RIG/.bucket-name")
AK=$(colima ssh -p pr12869 -- bash -c '. /var/lib/qwen-w1b/oss-real.env; printf %s "$OSS_ACCESS_KEY_ID"')
SK=$(colima ssh -p pr12869 -- bash -c '. /var/lib/qwen-w1b/oss-real.env; printf %s "$OSS_ACCESS_KEY_SECRET"')
[ ${#AK} -gt 10 ] && [ ${#SK} -gt 10 ] && [ ${#BUCKET} -gt 20 ] || { echo "secret probes are empty; refusing to publish"; exit 1; }
# Redact the bucket suffix everywhere (the logs already redact it; this is the backstop), then prove nothing is left.
grep -rl -- "$BUCKET" "$STAGE" | while read -r f; do LC_ALL=C sed -i '' "s/$BUCKET/qwen-pr13138-verify-xxxxxx/g" "$f"; done
# The OSS SignatureDoesNotMatch error (wrong-secret case) echoes the AccessKeyId.
grep -rlF -- "$AK" "$STAGE" | while read -r f; do LC_ALL=C sed -i '' "s/$AK/<access-key-id>/g" "$f"; done
LAN="192.168.0"; LAN="$LAN."
for s in "$AK" "$SK" "$BUCKET" "$LAN"; do
  if grep -rqF -- "$s" "$STAGE"; then echo "LEAK: a secret/private string is still present"; exit 1; fi
done
echo "secret scan clean over $(find "$STAGE" -type f | wc -l | tr -d ' ') files"
cd "$REPO"
git fetch -q origin main:refs/remotes/origin/main
PARENT=$(git rev-parse refs/remotes/origin/main | tr -d '[:space:]')
TIP=$(git ls-remote wenshao "refs/heads/$BR" | cut -f1 | tr -d '[:space:]')
export GIT_INDEX_FILE="$RIG/.assets-index"; rm -f "$GIT_INDEX_FILE"
if [ -n "$TIP" ]; then
  git cat-file -e "${TIP}^{commit}" 2>/dev/null || git fetch -q wenshao "$TIP"
  git read-tree "$TIP"; PARENT=$TIP
else
  git read-tree --empty
fi
( cd "$STAGE" && find pr13138 -type f | sort ) | while read -r f; do
  b=$(git hash-object -w "$STAGE/$f"); git update-index --add --cacheinfo "100644,$b,$f"
done
TREE=$(git write-tree)
C=$(git commit-tree "$TREE" -p "$PARENT" -m "PR 13138 real-environment verification evidence, round 2" | tr -d '[:space:]')
unset GIT_INDEX_FILE
[ ${#C} -eq 40 ] || { echo "bad commit id"; exit 1; }
[ -z "$TIP" ] || git merge-base --is-ancestor "$TIP" "$C" || { echo "not a fast-forward"; exit 1; }
REFSPEC="${C}:refs/heads/${BR}"
case "$REFSPEC" in [0-9a-f]*:refs/heads/assets-pr13138) ;; *) echo "bad refspec $REFSPEC"; exit 1;; esac
echo "pushing $REFSPEC (parent $PARENT)"
git push wenshao "$REFSPEC" || { sleep 3; git ls-remote wenshao "refs/heads/$BR"; git push -v wenshao "$REFSPEC"; }
echo "$C" > "$RIG/assets-commit-r2.txt"
git ls-remote wenshao "refs/heads/$BR"
