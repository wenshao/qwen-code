#!/bin/bash
# usage: unit.sh <worktree> <tag>
W=$1; T=$2; O=/root/verify/pr14858/unit/$T; mkdir -p $O
cd $W/packages/core && CI=true npx vitest run src/services/loopDetectionService.test.ts src/core/client.test.ts --reporter=json --outputFile=$O/core.json > $O/core.log 2>&1; echo "core=$?"
cd $W/packages/cli && CI=true npx vitest run src/utils/loop-detected-message.test.ts src/nonInteractiveCli.test.ts src/ui/components/LoopDetectionConfirmation.test.tsx src/ui/hooks/use-llm-stream.test.tsx src/ui/opentui/event-adapter.test.ts src/acp-integration/session/Session.test.ts --reporter=json --outputFile=$O/cli.json > $O/cli.log 2>&1; echo "cli=$?"
cd $W/packages/acp-bridge && CI=true npx vitest run src/bridge.test.ts --reporter=json --outputFile=$O/acp.json > $O/acp.log 2>&1; echo "acp=$?"
cd $W/packages/sdk-typescript && CI=true npx vitest run test/unit/daemonUi.test.ts --reporter=json --outputFile=$O/sdk.json > $O/sdk.log 2>&1; echo "sdk=$?"
cd $W/packages/web-shell && CI=true npx vitest run client/adapters/transcriptToMessages.test.ts client/hooks/useMessages.test.ts --reporter=json --outputFile=$O/ws.json > $O/ws.log 2>&1; echo "ws=$?"
for f in $O/*.json; do python3 -c "
import json,sys
d=json.load(open('$f'))
print('$(basename $f)', 'files',d['numTotalTestSuites'],'tests',d['numTotalTests'],'passed',d['numPassedTests'],'failed',d['numFailedTests'],'skipped',d.get('numPendingTests',0))
"; done
echo UNIT_DONE
