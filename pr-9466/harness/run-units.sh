#!/bin/bash
cd "$1"
start=$(date +%s)
(cd packages/core && CI=true npx vitest run src/core/client.test.ts src/core/client-goal.test.ts src/core/goal-turn-integration.test.ts src/core/llm-chat.test.ts src/core/turn.test.ts src/services/chatRecordingService.test.ts src/services/fileHistoryService.test.ts src/services/sessionService.test.ts --reporter=json --outputFile=/root/verify/pr9466/units-$2-core.json > /root/verify/pr9466/units-$2-core.log 2>&1); echo "CORE_EXIT=$? t=$(( $(date +%s)-start ))s"
(cd packages/cli && CI=true npx vitest run src/ui/utils/historyMapping.test.ts src/ui/commands/restoreCommand.test.ts src/ui/utils/resumeHistoryUtils.test.ts src/ui/hooks/useResumeCommand.test.ts src/ui/hooks/useResumeCommand.managed.test.ts src/ui/hooks/slashCommandProcessor.test.ts src/ui/AppContainer.test.tsx src/ui/hooks/use-llm-stream.test.tsx src/ui/hooks/useBranchCommand.test.ts src/ui/hooks/session-swap-telemetry.test.ts src/ui/opentui/live-session.test.ts src/acp-integration/session/Session.test.ts --reporter=json --outputFile=/root/verify/pr9466/units-$2-cli.json > /root/verify/pr9466/units-$2-cli.log 2>&1); echo "CLI_EXIT=$? t=$(( $(date +%s)-start ))s"
echo EXIT=done
