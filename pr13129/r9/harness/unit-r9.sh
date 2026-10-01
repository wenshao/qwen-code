#!/bin/bash
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; O=/Users/wenshao/pr13129-rig/out; S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/db41f725-f4b4-43d3-ba2e-f66bdb66df6b/scratchpad
cd $W && echo "head=$(git rev-parse --short HEAD)" && git diff --name-only 0a5f518b4f73fbd10ad58a764d456afc1961e9d1 HEAD | grep -E "\.test\.ts$" > $O/r9-changed-tests.txt
CLI=$(grep "^packages/cli/" $O/r9-changed-tests.txt | sed 's#packages/cli/##' | tr '\n' ' ')
CORE=$(grep "^packages/core/" $O/r9-changed-tests.txt | sed 's#packages/core/##' | grep -v "core/client.test.ts" | tr '\n' ' ')
echo "files: cli $(echo $CLI | wc -w) core $(echo $CORE | wc -w); load $(sysctl -n vm.loadavg)"
cd $W/packages/cli && npx vitest run $CLI --reporter=verbose > $O/r9-unit-cli.log 2>&1; echo "cli exit=$?"
cd $W/packages/core && npx vitest run $CORE --reporter=dot > $O/r9-unit-core.log 2>&1; echo "core exit=$?"
for f in r9-unit-cli r9-unit-core; do echo "== $f: $(grep -E '^ +Tests ' $O/$f.log)"; done
grep -E '^ +×' $O/r9-unit-cli.log | sed 's/^ *× //' | cut -c1-200
# pin check: reverse the merge guard (hosted-workspace-tool-turn.ts, 251117c3d5..433f9d358e)
cd $W && git diff 251117c3d5 433f9d358e -- packages/cli/src/serve/hosted-workspace-tool-turn.ts > $S/433f.patch
if git apply -R --check $S/433f.patch; then git apply -R $S/433f.patch; git status --short
  cd $W/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts --reporter=verbose 2>&1 | grep -E '^ +×|^ +Tests ' | sed 's/^ *//' | cut -c1-220
  cd $W && git checkout HEAD -- packages/cli/src/serve/hosted-workspace-tool-turn.ts && git status --short && echo restored
else echo "reverse patch does not apply"; fi
