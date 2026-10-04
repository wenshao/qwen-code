#!/bin/bash
# PR #13243 round 2: alternate f877 / ee0f serve sources in wt43 under the same host load. Exit codes read directly.
set -u
W=/Users/wenshao/pr13129-rig/wt43; O=/Users/wenshao/pr13129-rig/out/r43/unit-ab; mkdir -p $O
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $W
[ "$(git rev-parse HEAD)" = "ee0f4c901c2ab5db05e43ad7aa3d3ec7e03eb70d" ] || { echo "WRONG HEAD"; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "DIRTY"; exit 2; }
arm() {
  if [ "$1" = f877 ]; then git checkout f8775584fe20f7baeeeae72fd0c0abd9fa724352 -- packages/cli/src/serve; else git checkout ee0f4c901c2ab5db05e43ad7aa3d3ec7e03eb70d -- packages/cli/src/serve; fi
  echo "arm=$1 diff-vs-ee0f-files=$(git diff --name-only HEAD -- packages/cli/src/serve | wc -l | tr -d ' ') load=$(sysctl -n vm.loadavg | cut -d' ' -f2)"
}
for round in 1 2; do
  for a in f877 ee0f; do
    arm $a
    (cd packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts > $O/hhs-$a-$round.txt 2>&1); echo "  hhs $a round$round exit=$? $(grep -E '^ +Tests ' $O/hhs-$a-$round.txt)"
    (cd packages/cli && npx vitest run src/serve/hosted-hook-session.test.ts -t 'drains a long settled history' > $O/drain-$a-$round.txt 2>&1); echo "  drain $a round$round exit=$? $(grep -E '^ +Tests ' $O/drain-$a-$round.txt)"
  done
done
git checkout ee0f4c901c2ab5db05e43ad7aa3d3ec7e03eb70d -- packages/cli/src/serve
git reset -q HEAD -- packages/cli/src/serve
echo "restored: status=[$(git status --porcelain | wc -l | tr -d ' ')] $(date -u +%T)"
