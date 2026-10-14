#!/bin/bash
# Build packaged Harness bundles: dist-pr3 (trial merge) and dist-base (same tree,
# the PR's two CLI sources swapped back to main d28bc60d73).
set -u
RIG=/Users/wenshao/pr13986-rig; W=$RIG/src-pr; L=$RIG/out/build-ts3.log
MAIN=462cae3dd85aee26762bf6695b6b063803b1e0d8
FILES="packages/cli/src/serve/hosted-harness-session.ts packages/cli/src/serve/hosted-workspace-broker.ts"
cd $W
echo "=== $(date +%T) setup $(git rev-parse --short HEAD)" | tee $L
node scripts/setup-worktree.js >> $L 2>&1; echo "setup exit=$?" | tee -a $L
npm run build >> $L 2>&1; echo "build exit=$?" | tee -a $L
npm run bundle >> $L 2>&1; echo "bundle(pr) exit=$?" | tee -a $L
rm -rf $RIG/dist-pr3 && cp -Rc dist $RIG/dist-pr3 && echo "pr $(git rev-parse HEAD)" > $RIG/dist-pr3/COMMIT
grep -c "tool-sessions:active-holds" $RIG/dist-pr3/chunks/*.js 2>/dev/null | grep -v ':0' | head -3 | tee -a $L
git show $MAIN:packages/cli/src/serve/hosted-harness-session.ts > packages/cli/src/serve/hosted-harness-session.ts
git show $MAIN:packages/cli/src/serve/hosted-workspace-broker.ts > packages/cli/src/serve/hosted-workspace-broker.ts
echo "swapped; src diff vs main (non-test, non-doc, non-java):" | tee -a $L
git diff --name-only $MAIN -- packages | grep -v -E '\.test\.ts$|^packages/sdk-java/' | tee -a $L
npm run bundle >> $L 2>&1; echo "bundle(base) exit=$?" | tee -a $L
rm -rf $RIG/dist-base3 && cp -Rc dist $RIG/dist-base3 && echo "base = $MAIN sources for bundled CLI (PR's two serve files swapped back)" > $RIG/dist-base3/COMMIT
git checkout HEAD -- $FILES
echo "restored: $(git status --short -- $FILES | wc -l) dirty" | tee -a $L
grep -l "tool-sessions:active-holds" -r $RIG/dist-base3 | head -2 | sed 's/^/BASE-HAS-ROUTE?? /' | tee -a $L
echo "=== $(date +%T) BUILD-TS-DONE" | tee -a $L
