#!/bin/bash
# PR #13136: run the PR's changed TS tests at head, then pin each production change: revert that file to the base
# (3f56f74a6a), rerun its tests, count failures, restore. Pins fail closed: a reverse that does not apply is reported.
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
R=/Users/wenshao/pr13129-rig; W=$R/wt36; O=$R/out/unit36; BASE=3f56f74a6a
mkdir -p $O
cd $W && echo "head=$(git rev-parse --short HEAD) base=$BASE dirty=$(git status --porcelain | wc -l | tr -d ' ') load=$(sysctl -n vm.loadavg)"
run() { # label pkg tests...
  local l=$1 p=$2; shift 2
  (cd $W/packages/$p && npx vitest run "$@" --reporter=verbose --maxWorkers=2 --minWorkers=1 > $O/$l.log 2>&1); local e=$?
  echo "== $l exit=$e $(/usr/bin/grep -E '^ +Tests ' $O/$l.log | sed 's/^ *//')"
  /usr/bin/grep -E '^ +(×|✗)' $O/$l.log | sed 's/^ *//' | cut -c1-200 | head -40
}
run head-core core src/managed-runtime/managed-session-authority.hook-scale.test.ts src/managed-runtime/managed-session-authority.test.ts
run head-cli cli src/serve/hosted-harness-session.test.ts src/serve/hosted-hook-session.test.ts
pin() { # label pkg "prodfiles" tests...
  local l=$1 p=$2 files=$3; shift 3
  cd $W
  for f in $files; do git show $BASE:$f > $f || { echo "== pin $l: cannot read $BASE:$f (skipped)"; git checkout HEAD -- $files; return; }; done
  echo "-- pin $l reverted: $(git diff --stat -- $files | tail -1)"
  run pin-$l $p "$@"
  cd $W && git checkout HEAD -- $files && echo "   restored, dirty files: $(git status --porcelain | wc -l | tr -d ' ')"
}
pin core-authority core "packages/core/src/managed-runtime/managed-session-authority.ts packages/core/src/managed-runtime/managed-session-assembly.ts" src/managed-runtime/managed-session-authority.hook-scale.test.ts
pin cli-hook-session cli "packages/cli/src/serve/hosted-hook-session.ts" src/serve/hosted-hook-session.test.ts
pin cli-harness-session cli "packages/cli/src/serve/hosted-harness-session.ts" src/serve/hosted-harness-session.test.ts
echo UNIT36-DONE
