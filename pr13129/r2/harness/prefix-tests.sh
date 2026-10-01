#!/bin/bash
# Do the new tests pin the fixes? Run the 4 affected CLI test files (a) on head, (b) with the 4 production files of
# ec96690bde reverted to its parent, back to back; then restore. bash (word splitting) on purpose.
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; O=/Users/wenshao/pr13129-rig/out
F=(packages/cli/src/serve/hosted-harness-session.ts packages/cli/src/serve/hosted-hook-session.ts packages/cli/src/serve/hosted-workspace-tool-turn.ts packages/cli/src/serve/managed-hook-runtime.ts)
T="src/serve/hosted-hook-session.test.ts src/serve/managed-hook-runtime.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts"
cd $W/packages/cli
echo "load before head run: $(sysctl -n vm.loadavg)"
npx vitest run $T --reporter=verbose > $O/r2-tests-head.log 2>&1
cd $W && for f in "${F[@]}"; do git show ec96690bde^:$f > $f; done
git status --short
echo "load before pre-fix run: $(sysctl -n vm.loadavg)"
cd $W/packages/cli && npx vitest run $T --reporter=verbose > $O/r2-tests-prefix.log 2>&1
cd $W && git checkout HEAD -- "${F[@]}" && git status --short && echo restored
for L in head prefix; do echo "== $L: $(grep -E '^ +Tests ' $O/r2-tests-$L.log)"; grep -E '^ +×' $O/r2-tests-$L.log | sed 's/^ *× //' | cut -c1-200; done
