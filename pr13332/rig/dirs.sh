#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332
A=$1
W=/Users/wenshao/git/pr13332-$A
(cd $W/packages/core && npx vitest run src/managed-runtime src/services src/config/managed-session-log.test.ts --coverage.enabled=false --testTimeout=120000 --reporter=json --outputFile=$S/dirs-core-$A.json > $S/dirs-core-$A.log 2>&1)
(cd $W/packages/cli && npx vitest run src/serve --coverage.enabled=false --testTimeout=120000 --reporter=json --outputFile=$S/dirs-cli-$A.json > $S/dirs-cli-$A.log 2>&1)
echo DONE-$A
