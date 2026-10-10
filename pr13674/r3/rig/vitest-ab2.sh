#!/bin/bash
W=/Users/wenshao/pr13674-rig/src-h4; O=/Users/wenshao/pr13674-rig/out
PAT="ownerless parked Turn on the takeover load"
F="packages/cli/src/serve/hosted-harness-session.ts packages/cli/src/serve/hosted-workspace-profiles.ts"
run() { for i in 1 2 3 4 5 6; do (cd $W/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts -t "$PAT" > $O/vab2-$1-$i.log 2>&1); echo "$1 run$i exit=$? $(grep -E 'Tests  ' $O/vab2-$1-$i.log)"; done; }
run head
git -C $W checkout 2ebbd4e12d -- $F
run mainfiles
git -C $W checkout 77463e0147 -- $F
echo "restored: $(git -C $W diff 77463e0147 -- $F | wc -l | tr -d ' ') diff lines"
