#!/bin/bash
# Round 3: the PR's changed test files (15 core + 7 cli), default timeouts.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332/r3
export PATH="/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH"
CORE=(src/config/managed-session-log.test.ts src/managed-runtime/embedded-harness-scheduler.test.ts src/managed-runtime/http-managed-session-store.test.ts src/managed-runtime/local-shell-result-session.test.ts src/managed-runtime/managed-activation-store.test.ts src/managed-runtime/managed-harness-factory.test.ts src/managed-runtime/managed-session-authority.extension.test.ts src/managed-runtime/managed-session-authority.test.ts src/managed-runtime/managed-session-inbox.test.ts src/managed-runtime/managed-session-message-projection.test.ts src/managed-runtime/managed-session-metadata.test.ts src/managed-runtime/managed-session-record-sink.test.ts src/managed-runtime/original-receipt-checkpoint.test.ts src/services/session-legacy-execution-refusal.test.ts src/services/session-writer-lease.test.ts)
CLI=(src/config/settings.test.ts src/serve/hosted-channel-session.test.ts src/serve/hosted-file-history.test.ts src/serve/hosted-hook-session.test.ts src/serve/hosted-shell-publisher.test.ts src/serve/managed-runtime-tool-v3-routes.test.ts src/ui/use-box-metrics-loop-guard.test.tsx)
for T in "$@"; do
  W=/Users/wenshao/git/pr13332-$T
  (cd $W/packages/core && npx vitest run "${CORE[@]}" --coverage.enabled=false --reporter=json --outputFile=$S/t3-core-$T.json > $S/t3-core-$T.log 2>&1)
  (cd $W/packages/cli && npx vitest run "${CLI[@]}" --coverage.enabled=false --reporter=json --outputFile=$S/t3-cli-$T.json > $S/t3-cli-$T.log 2>&1)
  echo "DONE $T"
done
