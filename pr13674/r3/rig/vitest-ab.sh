#!/bin/bash
# A/B the 5 hosted-harness-session tests that failed under load: PR head vs head with the PR's two TS files reverted to main 2ebbd4e1.
W=/Users/wenshao/pr13674-rig/src-h4; O=/Users/wenshao/pr13674-rig/out
PAT="child_acceptance commit|fences recovery 'continue' admission when 'authorizing'|ownerless parked Turn on the takeover load|owed adoption when every takeover load refuses|lost cancel admission at its watermark"
F="packages/cli/src/serve/hosted-harness-session.ts packages/cli/src/serve/hosted-workspace-profiles.ts"
for i in 1 2; do
  (cd $W/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts -t "$PAT" > $O/vab-head-$i.log 2>&1); echo "head run$i exit=$? $(grep -E 'Tests  ' $O/vab-head-$i.log)"
done
git -C $W checkout 2ebbd4e12d -- $F
git -C $W diff --stat 77463e0147 -- $F | tail -1
for i in 1 2; do
  (cd $W/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts -t "$PAT" > $O/vab-main-$i.log 2>&1); echo "main-files run$i exit=$? $(grep -E 'Tests  ' $O/vab-main-$i.log)"
done
git -C $W checkout 77463e0147 -- $F
echo "restored: $(git -C $W diff --stat 77463e0147 -- $F | wc -l | tr -d ' ') diff lines"
