#!/bin/bash
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; O=/Users/wenshao/pr13129-rig/out; S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/db41f725-f4b4-43d3-ba2e-f66bdb66df6b/scratchpad
MB=a7deb01bcb
cd $W && echo "head=$(git rev-parse --short HEAD) mergebase=$MB" && git diff --name-only $MB HEAD | /usr/bin/grep -E "\.test\.ts$" > $O/r11-changed-tests.txt
CLI=$(/usr/bin/grep "^packages/cli/" $O/r11-changed-tests.txt | sed 's#packages/cli/##' | tr '\n' ' ')
CORE=$(/usr/bin/grep "^packages/core/" $O/r11-changed-tests.txt | sed 's#packages/core/##' | /usr/bin/grep -v "core/client.test.ts" | tr '\n' ' ')
echo "files: cli $(echo $CLI | wc -w) core $(echo $CORE | wc -w); load $(sysctl -n vm.loadavg)"
cd $W/packages/cli && npx vitest run $CLI --reporter=verbose > $O/r11-unit-cli.log 2>&1; echo "cli exit=$?"
cd $W/packages/core && npx vitest run $CORE --reporter=dot > $O/r11-unit-core.log 2>&1; echo "core exit=$?"
for f in r11-unit-cli r11-unit-core; do echo "== $f: $(/usr/bin/grep -E '^ +Tests ' $O/$f.log)"; done
/usr/bin/grep -E '^ +×' $O/r11-unit-cli.log | sed 's/^ *× //' | cut -c1-200
pin() { # name commit prodfile testfiles...
  local n=$1 c=$2 f=$3; shift 3
  cd $W && git show $c -- $f > $S/pin-$n.patch
  if ! git apply -R $S/pin-$n.patch; then echo "== pin $n: reverse patch does NOT apply at HEAD (skipped)"; return; fi
  echo "== pin $n (revert $c $f): $(git diff --stat -- $f | tail -1)"
  cd $W/packages/cli && npx vitest run "$@" --reporter=verbose 2>&1 | /usr/bin/grep -E '^ +×|^ +Tests ' | sed 's/^ *//' | cut -c1-220
  cd $W && git checkout HEAD -- "$f" && git status --short | wc -l | xargs echo "restored, dirty files:"
}
pin P1-runtime 4dbdd48736 packages/cli/src/serve/managed-hook-runtime.ts src/serve/managed-hook-runtime.test.ts
pin P2-prompt-model 4dbdd48736 packages/cli/src/serve/hosted-hook-model.ts src/serve/hosted-hook-model.test.ts
pin P3-session 4dbdd48736 packages/cli/src/serve/hosted-harness-session.ts src/serve/hosted-harness-session.test.ts
pin P4-unknown-recovery 483c81e4c9 packages/cli/src/serve/hosted-runtime-recovery.ts src/serve/hosted-runtime-recovery.test.ts src/serve/hosted-workspace-broker.test.ts
pin P5-unknown-broker 483c81e4c9 packages/cli/src/serve/hosted-workspace-broker.ts src/serve/hosted-runtime-recovery.test.ts src/serve/hosted-workspace-broker.test.ts
