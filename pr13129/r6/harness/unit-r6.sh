#!/bin/bash
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; O=/Users/wenshao/pr13129-rig/out; S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/db41f725-f4b4-43d3-ba2e-f66bdb66df6b/scratchpad
cd $W && echo "head=$(git rev-parse --short HEAD)" && git diff --name-only 0a5f518b4f73fbd10ad58a764d456afc1961e9d1 HEAD | grep -E "\.test\.ts$" > $O/r6-changed-tests.txt
CLI=$(grep "^packages/cli/" $O/r6-changed-tests.txt | sed 's#packages/cli/##' | tr '\n' ' ')
CORE=$(grep "^packages/core/" $O/r6-changed-tests.txt | sed 's#packages/core/##' | grep -v "core/client.test.ts" | tr '\n' ' ')
echo "files: cli $(echo $CLI | wc -w) core $(echo $CORE | wc -w); load $(sysctl -n vm.loadavg)"
cd $W/packages/cli && npx vitest run $CLI --reporter=verbose > $O/r6-unit-cli.log 2>&1; echo "cli exit=$?"
cd $W/packages/core && npx vitest run $CORE --reporter=dot > $O/r6-unit-core.log 2>&1; echo "core exit=$?"
for f in r6-unit-cli r6-unit-core; do echo "== $f: $(grep -E '^ +Tests ' $O/$f.log)"; done
grep -E '^ +×' $O/r6-unit-cli.log | sed 's/^ *× //' | cut -c1-200
# pin check: reverse af89ec27ac production change (one line in hosted-hook-session.ts)
cd $W && git show af89ec27ac -- packages/cli/src/serve/hosted-hook-session.ts > $S/af89.patch
if git apply -R --check $S/af89.patch; then git apply -R $S/af89.patch; git status --short
  cd $W/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-hook-session.test.ts --reporter=verbose 2>&1 | grep -E '^ +×|^ +Tests ' | sed 's/^ *//' | cut -c1-220
  cd $W && git checkout HEAD -- packages/cli/src/serve/hosted-hook-session.ts && git status --short && echo restored
else echo "reverse patch does not apply"; fi
