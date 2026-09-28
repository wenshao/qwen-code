#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad
for c in ${CASES:-intent await-runtime result-message result-checkpoint result-reply turn-reply}; do
  CLI_ENTRY=$SP/${FG6S_ARM:-wt-fg6s}/dist/cli.js $SP/run-it2.sh ${WT:-wt-r8} ${TAGP:-r8}-fg6s-$c ${ITDB:-p848it} 'HostedWorkspaceToolTurnIT#sessionStoreFailuresNeverReplayEffectsOnMySql' -Dqwen.fg6b.case=$c > /dev/null
  L=$SP/logs/it-${TAGP:-r8}-fg6s-$c.log
  echo "== $c: $(grep -cE 'BUILD SUCCESS' $L) success; $(grep -E '^FG6B-SHELL|HOSTED_STORE_FAILURES_OK' $L | tr '\n' ' ')"
  grep -E "^RECEIPT" $L | head -1 | cut -c1-260
  grep -E "^\[ERROR\]   |AssertionError|Expecting|expected" $L | head -4 | cut -c1-300
done
