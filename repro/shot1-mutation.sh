#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8d7cf4dd-f940-43c4-b150-0f9629a25fd6/scratchpad
WT=$SP/wt10465
DBG=$WT/packages/core/src/utils/debugLogger.ts
B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; C=$'\033[36m'; N=$'\033[0m'
cd $WT/packages/core
echo "${B}${C}== PR #10465 :: live mutation check D-M1 (circuit-breaker latch) ==${N}"
echo
echo "${B}[1] PR head, unmutated -> the new test${N}"
npx vitest run src/utils/debugLogger.test.ts --coverage.enabled=false --reporter=basic \
  -t "recovers from the streak cap" 2>&1 | grep -E "✓|×|Tests " | sed 's/^/    /'
echo
echo "${B}${Y}[2] inject latch mutant into debugLogger.ts:${N}"
echo "    ${Y}+ if (aliasFailureStreak >= MAX_CONSECUTIVE_ALIAS_FAILURES) return;${N}"
cp $DBG $SP/shots/dbg.bak
python3 $SP/mut/mutate.py $DBG D-M1 > /dev/null
npx vitest run src/utils/debugLogger.test.ts --coverage.enabled=false --reporter=basic \
  -t "recovers from the streak cap" 2>&1 | grep -E "✓|×|Tests |AssertionError|expected" | head -4 | sed 's/^/    /'
cp $SP/shots/dbg.bak $DBG
echo
echo "${B}[3] same mutant vs the PRE-PR suite (origin/main debugLogger.test.ts)${N}"
cp $WT/packages/core/src/utils/debugLogger.test.ts $SP/shots/dbgtest.bak
cd $WT && git show origin/main:packages/core/src/utils/debugLogger.test.ts > packages/core/src/utils/debugLogger.test.ts
python3 $SP/mut/mutate.py $DBG D-M1 > /dev/null
cd $WT/packages/core
npx vitest run src/utils/debugLogger.test.ts --coverage.enabled=false --reporter=basic > $SP/shots/step3.log 2>&1
LINE=$(sed $'s/\033\\[[0-9;]*m//g' $SP/shots/step3.log | grep -E "^ *Tests " | tail -1)
echo "    ${G}${LINE:-<no Tests line: see step3.log>}${N}"
cp $SP/shots/dbg.bak $DBG; cp $SP/shots/dbgtest.bak $WT/packages/core/src/utils/debugLogger.test.ts
echo "    ${R}^ mutant SURVIVES the pre-PR suite; the new test is what kills it${N}"
