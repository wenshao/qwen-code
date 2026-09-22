#!/bin/bash
# usage: run-tests.sh <arm> <tag>  → per-package vitest JSON for the PR's changed test files
ARM=$1; TAG=$2; R=/root/verify/pr12258-r2; W=$R/$ARM; O=$R/tests-$TAG; mkdir -p $O
run() { pkg=$1; shift; ( cd $W/$pkg && CI=true timeout 900 npx vitest run "$@" --reporter=json --outputFile=$O/$(echo $pkg | tr / _).json > $O/$(echo $pkg | tr / _).log 2>&1; echo "$pkg exit=$?" ); }
run packages/core src/subagents/subagent-manager.test.ts src/tools/mcp-client-v2.test.ts src/tools/mcp-client.test.ts src/tools/mcp-pool-key.test.ts src/tools/mcp-tool.test.ts src/tools/session-mcp-view.test.ts src/tools/tool-registry.test.ts src/utils/toolResultDisplayCompaction.test.ts
run packages/acp-bridge src/compactionEngine.test.ts src/eventBus.test.ts $( [ -f $W/packages/acp-bridge/src/mcp-app-tools.test.ts ] && echo src/mcp-app-tools.test.ts )
run packages/cli src/acp-integration/acpAgent.test.ts src/acp-integration/session/Session.test.ts src/acp-integration/session/history-replay-page.test.ts src/nonInteractive/control/controllers/systemController.test.ts src/serve/mcp-app-sandbox.test.ts src/serve/server.test.ts src/serve/server/telemetry-catalog.test.ts src/serve/server/telemetry.test.ts
run packages/sdk-typescript test/unit/DaemonClient.test.ts test/unit/daemon-public-surface.test.ts test/unit/queryOptionsSchema.test.ts
run packages/web-shell client/components/messages/McpApp.dom.test.tsx client/daemon/session/DaemonSessionProvider.test.tsx client/daemon/session/turn-navigation-store.test.ts
