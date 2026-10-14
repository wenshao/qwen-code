#!/bin/bash
# Targeted gates for the PR's touched workspaces, run from each package dir.
WT=$1; OUT=$2; mkdir -p "$OUT"
cd "$WT/packages/cli" && env -u QWEN_CODE_SERVE -u QWEN_RUNTIME_DIR npx vitest run src/acp-integration/session/team-sink.test.ts src/acp-integration/session/Session.test.ts src/acp-integration/session/types.test.ts src/ui/utils/export/export-transcript-document.test.ts > "$OUT/cli.log" 2>&1; echo "cli exit $?" >> "$OUT/summary.txt"
cd "$WT/packages/acp-bridge" && npx vitest run src/bridgeClient.test.ts src/transcript-replay.test.ts > "$OUT/acp-bridge.log" 2>&1; echo "acp-bridge exit $?" >> "$OUT/summary.txt"
cd "$WT/packages/sdk-typescript" && npx vitest run test/agent-identity.test.ts > "$OUT/sdk.log" 2>&1; echo "sdk exit $?" >> "$OUT/summary.txt"
cd "$WT/packages/core" && npx vitest run src/agents/team > "$OUT/core-team.log" 2>&1; echo "core-team exit $?" >> "$OUT/summary.txt"
cd "$WT/packages/web-shell" && npx vitest run --config vitest.config.ts adapters/transcriptToMessages.test.ts components/messages/SystemMessage.test.tsx components/messages/tools/SubAgentPanel.test.tsx > "$OUT/web-shell.log" 2>&1; echo "web-shell exit $?" >> "$OUT/summary.txt"
echo DONE >> "$OUT/summary.txt"
