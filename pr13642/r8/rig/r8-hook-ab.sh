#!/bin/bash
# Isolated A/B of ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql on MySQL:
# main da224e61 (wt-base) vs trial merge 6f5f7f6a+da224e61 (wt-main2), alternating, N rounds.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
N=${1:-3}
for i in $(seq 1 $N); do
  for arm in base main2; do bash $S/rerun-hook.sh $arm $arm mysql r8-$arm-$i; done
done
