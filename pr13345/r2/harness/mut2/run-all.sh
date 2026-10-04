#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
source $S/env22.sh
export MUTANTS_FILE=$S/mut2/mutants.mjs
ARM=$1; [ "$ARM" = old ] || [ "$ARM" = new ] || exit 2
IDS=$(node -e 'import(process.env.MUTANTS_FILE).then(m=>console.log(m.MUTANTS.filter(x=>x.arms.includes(process.argv[1])).map(x=>x.id).join(" ")))' $ARM)
[ -n "$IDS" ] || { echo "no ids"; exit 2; }
PRE="M00-full"; [ $ARM = new ] && PRE="M00-full M00-witness"
echo "PLAN $ARM $PRE $IDS"
for ID in $PRE $IDS; do
  $S/mut2/run-mutant.sh $ARM $ID || { echo "ABORT $ARM $ID"; exit 9; }
done
echo "ALLDONE $ARM"
