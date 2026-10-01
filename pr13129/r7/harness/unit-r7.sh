#!/bin/bash
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; O=/Users/wenshao/pr13129-rig/out; S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/db41f725-f4b4-43d3-ba2e-f66bdb66df6b/scratchpad
cd $W && echo "head=$(git rev-parse --short HEAD)" && git diff --name-only 0a5f518b4f73fbd10ad58a764d456afc1961e9d1 HEAD | grep -E "\.test\.ts$" > $O/r7-changed-tests.txt
CLI=$(grep "^packages/cli/" $O/r7-changed-tests.txt | sed 's#packages/cli/##' | tr '\n' ' ')
CORE=$(grep "^packages/core/" $O/r7-changed-tests.txt | sed 's#packages/core/##' | grep -v "core/client.test.ts" | tr '\n' ' ')
echo "files: cli $(echo $CLI | wc -w) core $(echo $CORE | wc -w); load $(sysctl -n vm.loadavg)"
cd $W/packages/cli && npx vitest run $CLI --reporter=verbose > $O/r7-unit-cli.log 2>&1; echo "cli exit=$?"
cd $W/packages/core && npx vitest run $CORE --reporter=dot > $O/r7-unit-core.log 2>&1; echo "core exit=$?"
for f in r7-unit-cli r7-unit-core; do echo "== $f: $(grep -E '^ +Tests ' $O/$f.log)"; done
grep -E '^ +×' $O/r7-unit-cli.log | sed 's/^ *× //' | cut -c1-200
# pin check: reverse c5a4cd2853 production change (hosted-harness-session.ts)
cd $W && git show c5a4cd2853 -- packages/cli/src/serve/hosted-harness-session.ts > $S/c5a4.patch
if git apply -R --check $S/c5a4.patch; then git apply -R $S/c5a4.patch; git status --short
  cd $W/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts --reporter=verbose 2>&1 | grep -E '^ +×|^ +Tests ' | sed 's/^ *//' | cut -c1-220
  cd $W && git checkout HEAD -- packages/cli/src/serve/hosted-harness-session.ts && git status --short && echo restored
else echo "reverse patch does not apply"; fi
