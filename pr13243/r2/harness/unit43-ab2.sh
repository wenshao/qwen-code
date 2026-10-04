#!/bin/bash
# Targeted A/B of the two tests that kept failing on ee0f; alternate arms, read exit codes directly.
set -u
W=/Users/wenshao/pr13129-rig/wt43; O=/Users/wenshao/pr13129-rig/out/r43/unit-ab2; mkdir -p $O
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $W
[ "$(git rev-parse HEAD)" = "ee0f4c901c2ab5db05e43ad7aa3d3ec7e03eb70d" ] && [ -z "$(git status --porcelain)" ] || { echo "NOT CLEAN"; exit 2; }
PAT='refuses a cold load when a settled file tool outcome is missing|across workspace_busy recovery'
for i in 1 2 3 4; do
  for a in f877 ee0f; do
    if [ $a = f877 ]; then git checkout f8775584fe20f7baeeeae72fd0c0abd9fa724352 -- packages/cli/src/serve; else git checkout ee0f4c901c2ab5db05e43ad7aa3d3ec7e03eb70d -- packages/cli/src/serve; fi
    (cd packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts -t "$PAT" > $O/$a-$i.txt 2>&1); rc=$?
    echo "$a run$i exit=$rc $(grep -E '^ +Tests ' $O/$a-$i.txt) load=$(sysctl -n vm.loadavg | cut -d' ' -f2) failed=[$(grep -E '^ +× ' $O/$a-$i.txt | sed -E 's/^ +× Hosted Harness no-tool session > //; s/ [0-9]+ms$//' | tr '\n' ';')]"
  done
done
git checkout ee0f4c901c2ab5db05e43ad7aa3d3ec7e03eb70d -- packages/cli/src/serve; git reset -q HEAD -- packages/cli/src/serve
echo "restored status=[$(git status --porcelain | wc -l | tr -d ' ')]"
