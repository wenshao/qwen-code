#!/bin/bash
# usage: touched.sh <arm-dir> <tag>  -- runs the PR's touched core + cli suites, JSON reports into $S
set -u
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332
W=$1; T=$2
CORE=(src/config/managed-session-log.test.ts src/managed-runtime/embedded-harness-scheduler.test.ts src/managed-runtime/http-managed-session-store.test.ts src/managed-runtime/local-shell-result-session.test.ts src/managed-runtime/managed-activation-store.test.ts src/managed-runtime/managed-harness-factory.test.ts src/managed-runtime/managed-session-authority.test.ts src/managed-runtime/managed-session-inbox.test.ts src/managed-runtime/managed-session-message-projection.test.ts src/managed-runtime/managed-session-metadata.test.ts src/managed-runtime/managed-session-record-sink.test.ts src/managed-runtime/original-receipt-checkpoint.test.ts src/services/session-legacy-execution-refusal.test.ts src/services/session-writer-lease.test.ts)
CLI=(src/serve/hosted-hook-session.test.ts src/serve/hosted-shell-publisher.test.ts src/serve/managed-runtime-tool-v3-routes.test.ts)
(cd $W/packages/core && npx vitest run "${CORE[@]}" --coverage.enabled=false --reporter=json --outputFile=$S/touched-core-$T.json > $S/touched-core-$T.log 2>&1; echo "exit=$?" >> $S/touched-core-$T.log)
(cd $W/packages/cli && npx vitest run "${CLI[@]}" --coverage.enabled=false --reporter=json --outputFile=$S/touched-cli-$T.json > $S/touched-cli-$T.log 2>&1; echo "exit=$?" >> $S/touched-cli-$T.log)
