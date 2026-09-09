cd /root/git/qwen-code-x6
echo "### Does merging PR #11412 change main at all?"
echo
echo "\$ git merge-tree --write-tree origin/main pr11412-head"
MT=$(git merge-tree --write-tree origin/main pr11412-head); echo "$MT"
echo
echo "\$ git rev-parse origin/main^{tree}"
MAIN=$(git rev-parse origin/main^{tree}); echo "$MAIN"
echo
if [ "$MT" = "$MAIN" ]; then
  echo "  ==> merged tree IS main's tree, byte for byte."
  echo "  ==> merging #11412 is a NO-OP: #11406 (3a75f37ef5) already landed this fix."
fi
echo
echo "\$ git diff --stat origin/main pr11412-head -- packages/web-shell/client/App.test.tsx"
git diff --stat origin/main pr11412-head -- packages/web-shell/client/App.test.tsx
echo "  (main additionally carries #11406's mockClear() line; #11412 does not)"
