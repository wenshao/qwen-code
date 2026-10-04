#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
source $S/env22.sh
ARM=$1; [ -n "$ARM" ] || exit 2
cd $S/wt-$ARM/packages/core || exit 2
npx vitest run src/managed-runtime --reporter=json --outputFile=$S/results/ts-full-$ARM.json --coverage.enabled=false > $S/logs/ts-full-$ARM.log 2>&1
echo "exit=$?" >> $S/logs/ts-full-$ARM.log
node -e '
const r=require(process.argv[1]);
console.log(`TSFULL ${process.argv[2]} files=${r.numTotalTestSuites} total=${r.numTotalTests} passed=${r.numPassedTests} failed=${r.numFailedTests} skipped=${r.numPendingTests+r.numTodoTests}`);
for (const f of r.testResults){ if(f.status!=="passed"){ const fails=f.assertionResults.filter(a=>a.status==="failed"); console.log(`  FILE ${f.status} ${f.name.split("/packages/core/")[1]} ${fails.length?"":(f.message||"").slice(0,200)}`); for(const a of fails) console.log(`    FAIL ${a.fullName}`);} }
' $S/results/ts-full-$ARM.json $ARM | tee $S/results/ts-full-$ARM.txt
