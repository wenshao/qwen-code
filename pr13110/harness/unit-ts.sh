#!/bin/bash
# macOS host: the PR's focused vitest files, run from the package directories.  usage: unit-ts.sh <worktree> <label>
set -u
. /rig/rig.env
W=$RIG/$1; L=$2; export PATH=$(dirname $NODE):$PATH
cd $W/packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts src/serve/managed-runtime-file-history.test.ts src/serve/managed-runtime-provider-protocol.test.ts src/serve/managed-runtime-provider-worker.test.ts src/serve/hosted-workspace-broker.test.ts > $RIG/out/unit-$L-cli.log 2>&1; echo "[$L] cli exit=$? $(grep -a -E '^ *(Test Files|Tests) ' $RIG/out/unit-$L-cli.log | tr -s ' ' | tr '\n' ';')"
cd $W/packages/core && npx vitest run src/services/fileHistoryService.test.ts src/tools/managed-tool-file-history.test.ts > $RIG/out/unit-$L-core.log 2>&1; echo "[$L] core exit=$? $(grep -a -E '^ *(Test Files|Tests) ' $RIG/out/unit-$L-core.log | tr -s ' ' | tr '\n' ';')"
