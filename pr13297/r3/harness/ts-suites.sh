#!/bin/bash
# usage: ts-suites.sh <arm>
arm=$1; W=/Users/wenshao/git/qwen-code-pr13297-$arm; S=$(dirname "$0")
(cd $W/packages/cli && npx vitest run src/serve/local-process-runtime-activator.test.ts src/serve/managed-runtime-provider.test.ts src/serve/broker-managed-runtime-provider.test.ts src/serve/hosted-harness-session.test.ts src/serve/hosted-harness-session.issue-13328.test.ts > $S/ts-$arm-cli.log 2>&1; echo "rc=$?" >> $S/ts-$arm-cli.log)
(cd $W/packages/core && npx vitest run src/tools/managed-tool-runtime.test.ts src/tools/managed-tool-file-history-protocol.test.ts src/managed-runtime/http-managed-session-store.test.ts > $S/ts-$arm-core.log 2>&1; echo "rc=$?" >> $S/ts-$arm-core.log)
(cd $W/packages/acp-bridge && npx vitest run > $S/ts-$arm-acp.log 2>&1; echo "rc=$?" >> $S/ts-$arm-acp.log)
for p in cli core acp; do echo "$arm $p: $(grep -E '^ +Tests ' $S/ts-$arm-$p.log | tail -1) $(tail -1 $S/ts-$arm-$p.log)"; done
