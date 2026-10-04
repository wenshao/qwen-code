#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
source $S/env22.sh
ARM=$1; [ "$ARM" = base ] || [ "$ARM" = pr ] || exit 2
IDS=$(node -e 'import(process.argv[1]).then(m=>console.log(m.MUTANTS.filter(x=>x.arms.includes(process.argv[2])).map(x=>x.id).join(" ")))' $S/mut/mutants.mjs $ARM)
[ -n "$IDS" ] || { echo "no ids"; exit 2; }
echo "PLAN $ARM M00-baseline $IDS"
$S/mut/run-mutant.sh $ARM M00-baseline || exit 9
for ID in $IDS; do
  $S/mut/run-mutant.sh $ARM $ID || { echo "ABORT $ARM $ID"; exit 9; }
done
echo "ALLDONE $ARM"
