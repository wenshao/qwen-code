#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd $SP/wt-mut
for SPEC in "$@"; do
  git checkout -q -- packages/sdk-java
  for M in ${SPEC//+/ }; do node $SP/mutate.mjs $M || continue 2; done
  R=$($SP/run-it.sh wt-mut mut wt-pr mut-$SPEC 2>&1 | head -1)
  FAIL=$(grep -E "expected|Expecting|to be equal|but was|AssertionFailed|Status code" $SP/logs/it-mut-$SPEC.log | head -2 | tr '\n' ' ' | cut -c1-260)
  echo -e "$SPEC\t$R\t$FAIL" | tee -a $SP/logs/mut-it-results.tsv
done
git checkout -q -- packages/sdk-java
