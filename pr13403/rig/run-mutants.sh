#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad
cd $S
for m in M1-computeIfAbsent M2-client-synchronized M3-no-inlock-reread M4-bare-remove-release M5-release-success-only M6-no-unlock M7-no-inlock-put M8-close-no-clear M9-no-holders-inc M10-never-reclaim M11-global-lock M12-client-no-recheck; do
  python3 mutate.py $m 2>&1 | grep -E 'RESULT|FAIL' >> $S/mutants/results.txt
done
for p in 4; do
  for m in none M1-computeIfAbsent M2-client-synchronized; do
    python3 mutate.py $m $p 2>&1 | grep -E 'RESULT|FAIL' >> $S/mutants/results.txt
  done
done
echo MUTANTS-DONE >> $S/mutants/results.txt
