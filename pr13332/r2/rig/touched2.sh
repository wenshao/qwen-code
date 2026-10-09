#!/bin/bash
# Round 2: the PR's changed test files (16 core + 5 cli), 120 s test timeout.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332/r2
CORE=(src/config/managed-session-log.test.ts src/managed-runtime/embedded-harness-scheduler.test.ts src/managed-runtime/http-managed-session-store.test.ts src/managed-runtime/local-shell-result-session.test.ts src/managed-runtime/managed-activation-store.test.ts src/managed-runtime/managed-harness-factory.test.ts src/managed-runtime/managed-session-authority.extension.test.ts src/managed-runtime/managed-session-authority.test.ts src/managed-runtime/managed-session-inbox.test.ts src/managed-runtime/managed-session-message-projection.test.ts src/managed-runtime/managed-session-metadata.test.ts src/managed-runtime/managed-session-record-sink.test.ts src/managed-runtime/original-receipt-checkpoint.test.ts src/services/session-legacy-execution-refusal.test.ts src/services/session-writer-lease.test.ts)
CLI=(src/config/settings.test.ts src/serve/hosted-file-history.test.ts src/serve/hosted-hook-session.test.ts src/serve/hosted-shell-publisher.test.ts src/serve/managed-runtime-tool-v3-routes.test.ts)
for T in "$@"; do
  W=/Users/wenshao/git/pr13332-$T
  (cd $W/packages/core && npx vitest run "${CORE[@]}" --coverage.enabled=false --testTimeout=120000 --reporter=json --outputFile=$S/t2-core-$T.json > $S/t2-core-$T.log 2>&1)
  (cd $W/packages/cli && npx vitest run "${CLI[@]}" --coverage.enabled=false --testTimeout=120000 --reporter=json --outputFile=$S/t2-cli-$T.json > $S/t2-cli-$T.log 2>&1)
  echo "DONE $T"
done
