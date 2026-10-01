#!/bin/bash
# macOS host: publish the evidence tree to wenshao/qwen-code@assets-pr13138 as one commit whose parent is origin/main
# (so raw.githubusercontent.com resolves the commit SHA). Never touches HEAD or a worktree.
set -euo pipefail
RIG=/Users/wenshao/pr13138-rig; REPO=/Users/wenshao/git/qwen-code-x3; BR=assets-pr13138
STAGE=$RIG/stage
rm -rf "$STAGE"; mkdir -p "$STAGE/pr13138"/{results/e2e,results/console,harness/vm/realoss,harness/fig}
cp "$RIG"/fig/png/*.png "$STAGE/pr13138/"
cp "$RIG/assets-README.md" "$STAGE/pr13138/README.md"
cp "$RIG/cand-unsupported-entry.patch" "$RIG/cand-single-connection.patch" "$STAGE/pr13138/"
cp "$RIG"/out/e2e/*.log "$RIG"/out/e2e/*.json "$RIG"/out/e2e/*.txt "$STAGE/pr13138/results/e2e/"
cp "$RIG"/out/console/*.console "$STAGE/pr13138/results/console/"
cp "$RIG"/out/unit-*.log "$RIG/out/bundle-8bd11d5a-vs-989baf22.txt" "$STAGE/pr13138/results/"
cp "$RIG"/vm/*.mjs "$RIG"/vm/*.sh "$RIG"/vm/qwen-w1b.* "$STAGE/pr13138/harness/vm/"
cp "$RIG"/vm/realoss/OssAdmin.java "$STAGE/pr13138/harness/vm/realoss/"
cp "$RIG"/fig/*.mjs "$STAGE/pr13138/harness/fig/"
cp "$RIG"/build-ts.sh "$RIG"/build-jar.sh "$RIG"/norm-bundle.mjs "$RIG"/push-assets.sh "$STAGE/pr13138/harness/"
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
C=$(git commit-tree "$TREE" -p "$PARENT" -m "PR 13138 real-environment verification evidence" | tr -d '[:space:]')
unset GIT_INDEX_FILE
[ ${#C} -eq 40 ] || { echo "bad commit id"; exit 1; }
[ -z "$TIP" ] || git merge-base --is-ancestor "$TIP" "$C" || { echo "not a fast-forward"; exit 1; }
REFSPEC="${C}:refs/heads/${BR}"
case "$REFSPEC" in [0-9a-f]*:refs/heads/assets-pr13138) ;; *) echo "bad refspec $REFSPEC"; exit 1;; esac
echo "pushing $REFSPEC (parent $PARENT)"
git push wenshao "$REFSPEC" || { sleep 3; git ls-remote wenshao "refs/heads/$BR"; git push -v wenshao "$REFSPEC"; }
echo "$C" > "$RIG/assets-commit.txt"
git ls-remote wenshao "refs/heads/$BR"
