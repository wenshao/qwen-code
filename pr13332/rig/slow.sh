#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332
for a in head merge bht; do
  (cd /Users/wenshao/git/pr13332-$a/packages/core && npx vitest run src/config/managed-session-log.test.ts src/managed-runtime/managed-session-record-sink.test.ts --coverage.enabled=false --testTimeout=120000 --reporter=json --outputFile=$S/slow-core-$a.json >/dev/null 2>&1)
  (cd /Users/wenshao/git/pr13332-$a/packages/cli && npx vitest run src/serve/hosted-hook-session.test.ts --coverage.enabled=false --testTimeout=120000 --reporter=json --outputFile=$S/slow-cli-$a.json >/dev/null 2>&1)
done
