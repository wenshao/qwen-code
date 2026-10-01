#!/bin/bash
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; O=/Users/wenshao/pr13129-rig/out
CLI=$(grep "^packages/cli/" $O/r3-changed-tests.txt | sed 's#packages/cli/##' | tr '\n' ' ')
CORE=$(grep "^packages/core/" $O/r3-changed-tests.txt | sed 's#packages/core/##' | grep -v "core/client.test.ts" | tr '\n' ' ')
echo "load: $(sysctl -n vm.loadavg)"
cd $W/packages/cli && npx vitest run $CLI --reporter=verbose > $O/r3-unit-cli.log 2>&1; echo "cli exit=$?"
cd $W/packages/core && npx vitest run $CORE --reporter=dot > $O/r3-unit-core.log 2>&1; echo "core exit=$?"
RT=$(mktemp -d /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/db41f725-f4b4-43d3-ba2e-f66bdb66df6b/scratchpad/rt3.XXXX); QWEN_RUNTIME_DIR=$RT TMPDIR=$RT npx vitest run src/core/client.test.ts --reporter=dot > $O/r3-unit-core-client.log 2>&1; echo "client exit=$?"
for f in r3-unit-cli r3-unit-core r3-unit-core-client; do echo "== $f: $(grep -E '^ +Tests ' $O/$f.log)"; done
grep -E '^ +×' $O/r3-unit-cli.log | sed 's/^ *× //' | cut -c1-200
