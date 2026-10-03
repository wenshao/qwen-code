#!/bin/bash
L=/root/verify/pr13156/logs
for arm in head base; do
  cd /root/verify/pr13156/$arm/packages/core
  CI=true npx vitest run src/memory --reporter=default --reporter=json --outputFile=$L/suite-$arm.json > $L/suite-$arm.log 2>&1
  echo "EXIT=$?" >> $L/suite-$arm.log
done
cd /root/verify/pr13156/head
npx eslint --max-warnings 0 packages/core/src/memory/indexer.ts packages/core/src/memory/indexer.test.ts > $L/eslint-head.log 2>&1
echo "EXIT=$?" >> $L/eslint-head.log
npx prettier --check packages/core/src/memory/indexer.ts packages/core/src/memory/indexer.test.ts docs/design/auto-memory/memory-system.md > $L/prettier-head.log 2>&1
echo "EXIT=$?" >> $L/prettier-head.log
echo ALLDONE > $L/suite.done
